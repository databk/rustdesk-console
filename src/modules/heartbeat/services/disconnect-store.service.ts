import { Injectable, Logger } from '@nestjs/common';

/**
 * 断开连接内存存储服务
 * 暂存需要强制断开的连接ID，持续下发给客户端直到连接确实断开
 */
@Injectable()
export class DisconnectStoreService {
  private readonly logger = new Logger(DisconnectStoreService.name);

  /**
   * key: 设备UUID, value: 需要断开的连接ID集合
   */
  private store = new Map<string, Set<number>>();

  /**
   * 添加待断开连接
   * @param deviceUuid 设备UUID
   * @param connIds 需要断开的连接ID列表
   */
  addPendingDisconnects(deviceUuid: string, connIds: number[]): void {
    if (connIds.length === 0) {
      this.logger.debug(
        `[addPendingDisconnects] 空列表，跳过: uuid=${deviceUuid}`,
      );
      return;
    }

    const existing = this.store.get(deviceUuid);
    if (existing) {
      const before = existing.size;
      for (const connId of connIds) {
        existing.add(connId);
      }
      this.logger.log(
        `[addPendingDisconnects] 追加断开连接: uuid=${deviceUuid}, added=${connIds.length}, before=${before}, after=${existing.size}, connIds=${JSON.stringify(connIds)}`,
      );
    } else {
      this.store.set(deviceUuid, new Set(connIds));
      this.logger.log(
        `[addPendingDisconnects] 新增断开连接: uuid=${deviceUuid}, connIds=${JSON.stringify(connIds)}`,
      );
    }

    this.logger.debug(
      `[addPendingDisconnects] 当前store状态: totalDevices=${this.store.size}`,
    );
  }

  /**
   * 获取待断开连接列表（不清除）
   * 每次心跳时调用，持续返回直到客户端确认断开（不再上报该connId）
   * @param deviceUuid 设备UUID
   * @returns 需要断开的连接ID列表，无则返回空数组
   */
  getPendingDisconnects(deviceUuid: string): number[] {
    const pending = this.store.get(deviceUuid);
    const result = pending ? Array.from(pending) : [];
    this.logger.debug(
      `[getPendingDisconnects] 查询待断开连接: uuid=${deviceUuid}, count=${result.length}${result.length > 0 ? `, connIds=${JSON.stringify(result)}` : ''}`,
    );
    return result;
  }

  /**
   * 移除已断开的连接
   * 客户端心跳上报的 conns 中不再包含的 connId，说明已成功断开，从待断开列表中移除
   * @param deviceUuid 设备UUID
   * @param currentConns 客户端当前上报的活跃连接ID列表
   */
  removeDisconnected(deviceUuid: string, currentConns: number[]): void {
    const pending = this.store.get(deviceUuid);
    if (!pending || pending.size === 0) {
      this.logger.debug(
        `[removeDisconnected] 无待断开连接: uuid=${deviceUuid}`,
      );
      return;
    }

    const beforeSize = pending.size;
    const currentSet = new Set(currentConns);
    const removed: number[] = [];
    for (const connId of pending) {
      // 客户端不再上报该连接，说明已断开
      if (!currentSet.has(connId)) {
        removed.push(connId);
        pending.delete(connId);
      }
    }

    this.logger.log(
      `[removeDisconnected] 清理已断开连接: uuid=${deviceUuid}, removed=${removed.length}${removed.length > 0 ? `, removedConnIds=${JSON.stringify(removed)}` : ''}, before=${beforeSize}, after=${pending.size}, currentConns=${JSON.stringify(currentConns)}`,
    );

    // 如果待断开列表为空，清理 Map 条目
    if (pending.size === 0) {
      this.store.delete(deviceUuid);
      this.logger.debug(
        `[removeDisconnected] 待断开列表已清空，移除设备条目: uuid=${deviceUuid}`,
      );
    }
  }
}
