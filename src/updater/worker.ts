import { JobRecord } from './contracts';
import { Planner } from './planner';
import { JournalError, safeError, UpdateError } from './errors';
import { writeMaintenance } from './maintenance';
import { terminal } from './store';
export class UpdateWorker {
  constructor(
    private readonly planner: Planner,
    private readonly observe: (
      event: string,
      record: JobRecord,
    ) => Promise<void> = async () => {},
  ) {}
  private async operation(
    record: JobRecord,
    key: string,
    action: () => Promise<void>,
  ): Promise<void> {
    record.operations[key] = 'intent';
    await this.planner.store.saveJob(record);
    await this.observe(`${key}:intent`, record);
    await action();
    record.operations[key] = 'done';
    await this.planner.store.saveJob(record);
    await this.observe(`${key}:done`, record);
  }
  private async phase(
    record: JobRecord,
    phase: JobRecord['view']['phase'],
  ): Promise<void> {
    record.view.phase = phase;
    await this.planner.store.saveJob(record);
  }
  private async finish(
    record: JobRecord,
    status: JobRecord['view']['status'],
    code: string,
    message: string,
  ): Promise<void> {
    record.view.status = status;
    record.view.resultCode = code;
    record.view.safeMessage = message;
    record.view.finishedAt = new Date().toISOString();
    record.view.recoveryGuidance =
      status === 'recovery_required'
        ? `Keep business services isolated. Use the installed host recovery command with job ${record.view.jobId}; retain the protected updater state and backup.`
        : null;
    await this.planner.store.saveJob(record);
  }
  async run(jobId: string): Promise<void> {
    const record = await this.planner.store.job(jobId);
    if (terminal(record)) return;
    if (record.view.status === 'recovery_required') return;
    if (record.decision) {
      await this.completeDecision(record);
      return;
    }
    if (record.view.status === 'running') {
      await this.recover(
        record,
        new UpdateError(
          'WORKER_INTERRUPTED',
          'The update was interrupted before its commit decision.',
        ),
      );
      return;
    }
    const { deployment, backup, store, installation } = this.planner;
    record.view.status = 'running';
    await store.saveJob(record);
    try {
      await this.planner.revalidate(record.plan, true);
      await this.operation(record, 'prepare', () =>
        deployment.prepare(record.plan),
      );
      await this.phase(record, 'maintenance');
      await this.operation(record, 'fence', () =>
        writeMaintenance(installation.maintenanceFile, jobId, true, false),
      );
      await this.operation(record, 'stop', () => deployment.stopApplications());
      await this.phase(record, 'backing_up');
      await this.operation(record, 'backup', async () => {
        const context = this.planner.backupContext(jobId, true);
        record.snapshot = await backup.backup(context);
        await backup.validate(context, record.snapshot);
      });
      await this.phase(record, 'switching');
      await this.operation(record, 'switch', () =>
        deployment.switchApplications(record.plan),
      );
      await this.operation(record, 'validation_start', async () => {
        await writeMaintenance(installation.maintenanceFile, jobId, true, true);
        await deployment.startApplications();
      });
      await this.phase(record, 'verifying');
      await this.operation(record, 'verify', () =>
        deployment.verify(record.plan),
      );
      await this.phase(record, 'updating_helper');
      await this.operation(record, 'helper', () =>
        deployment.updateHelper(record.plan),
      );
      await this.phase(record, 'committing');
      await this.operation(record, 'persist_installation', () =>
        deployment.commit(record.plan),
      );
      await this.decide(record, 'commit_decided');
      await this.completeDecision(record);
    } catch (error: unknown) {
      if (error instanceof JournalError) throw error;
      await this.recover(record, error);
    }
  }
  private async decide(
    record: JobRecord,
    decision: NonNullable<JobRecord['decision']>,
  ): Promise<void> {
    await this.observe(`before:${decision}`, record);
    const durable = structuredClone(record);
    durable.decision = decision;
    await this.planner.store.saveJob(durable);
    record.decision = decision;
    await this.observe(`after:${decision}`, record);
  }
  /** decision 持久化后，任何重试都只核实/开放，绝不再恢复旧快照。 */
  private async completeDecision(record: JobRecord): Promise<void> {
    const restored = record.decision === 'restore_decided';
    try {
      // rename 后目录 fsync 可能失败；重启可读到 decision 不代表它已持久化。
      await this.planner.store.saveJob(record);
      await this.planner.deployment.verify(record.plan, restored);
      await writeMaintenance(
        this.planner.installation.maintenanceFile,
        record.view.jobId,
        false,
        true,
      );
      await this.observe('business_reopened', record);
      await this.finish(
        record,
        restored ? 'rolled_back' : 'succeeded',
        restored ? 'RESTORED' : 'UPDATED',
        restored
          ? 'The previous applications, database and business files were restored and verified.'
          : 'The system update was verified and committed.',
      );
    } catch (error: unknown) {
      if (error instanceof JournalError) throw error;
      await this.finish(
        record,
        'recovery_required',
        'POST_DECISION_REPAIR_REQUIRED',
        'The durable decision is preserved. Repair service availability without restoring an older database snapshot.',
      );
    }
  }
  private async recover(record: JobRecord, cause: unknown): Promise<void> {
    if (record.decision) {
      await this.completeDecision(record);
      return;
    }
    const { deployment, backup, installation } = this.planner;
    try {
      const switched = Boolean(record.operations.switch);
      if (record.operations.fence) {
        await writeMaintenance(
          installation.maintenanceFile,
          record.view.jobId,
          true,
          false,
        );
        await deployment.stopApplications();
      }
      if (switched) {
        await this.phase(record, 'restoring');
        if (!record.snapshot || record.operations.restore_data === 'intent')
          throw new UpdateError(
            'RESTORE_UNCERTAIN',
            'Interrupted data restoration needs manual verification before retrying.',
          );
        await this.operation(record, 'restore_deployment', () =>
          deployment.restoreDeployment(record),
        );
        if (record.operations.restore_data !== 'done')
          await this.operation(record, 'restore_data', async () => {
            const context = this.planner.backupContext(record.view.jobId, true);
            await backup.validate(context, record.snapshot!);
            await backup.restore(context, record.snapshot!);
          });
      }
      if (record.operations.fence) {
        await writeMaintenance(
          installation.maintenanceFile,
          record.view.jobId,
          true,
          true,
        );
        await deployment.startApplications();
        await deployment.verify(record.plan, true);
      }
      if (switched) {
        await this.decide(record, 'restore_decided');
        await this.completeDecision(record);
      } else {
        await writeMaintenance(
          installation.maintenanceFile,
          record.view.jobId,
          false,
          true,
        );
        const failure = safeError(cause);
        await this.finish(record, 'failed', failure.code, failure.message);
      }
    } catch (error: unknown) {
      if (error instanceof JournalError) throw error;
      await this.finish(
        record,
        'recovery_required',
        'RECOVERY_REQUIRED',
        'Automatic recovery could not be proved. Business access remains fenced; preserve backups and use host recovery.',
      );
    }
  }
}
