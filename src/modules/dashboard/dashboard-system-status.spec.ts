import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as si from 'systeminformation';
import { Repository } from 'typeorm';
import { Peer } from '../../common/entities/peer.entity';
import { Sysinfo } from '../../common/entities/sysinfo.entity';
import { AlarmAudit } from '../audit/entities/alarm-audit.entity';
import { ConnectionAudit } from '../audit/entities/connection-audit.entity';
import { FileAudit } from '../audit/entities/file-audit.entity';
import { DeviceGroup } from '../device-group/entities/device-group.entity';
import { User } from '../user/entities/user.entity';
import { SystemStatusDto } from './dto/dashboard-overview.dto';
import { DashboardService } from './dashboard.service';

jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  uptime: jest.fn(),
}));
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      statfs: jest.fn(),
    },
  };
});
jest.mock('systeminformation', () => ({
  currentLoad: jest.fn(),
  mem: jest.fn(),
}));

const currentLoadMock = jest.mocked(si.currentLoad);
const memMock = jest.mocked(si.mem);
const statfsMock = jest.mocked(fs.promises.statfs);
const uptimeMock = jest.mocked(os.uptime);

const createService = () =>
  new DashboardService(
    {} as Repository<User>,
    {} as Repository<Peer>,
    {} as Repository<DeviceGroup>,
    {} as Repository<ConnectionAudit>,
    {} as Repository<FileAudit>,
    {} as Repository<AlarmAudit>,
    {} as Repository<Sysinfo>,
  );

const readSystemStatus = (service: DashboardService) =>
  (
    service as unknown as {
      getSystemStatus: () => Promise<SystemStatusDto>;
    }
  ).getSystemStatus();

describe('DashboardService system status', () => {
  const originalDataDir = process.env.DATA_DIR;

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }
    currentLoadMock.mockReset();
    memMock.mockReset();
    statfsMock.mockReset();
    uptimeMock.mockReset();
  });

  it('uses available memory, the configured data dir, and OS uptime', async () => {
    process.env.DATA_DIR = '/data';
    currentLoadMock.mockResolvedValue({
      currentLoad: 64.44,
    } as Awaited<ReturnType<typeof si.currentLoad>>);
    memMock.mockResolvedValue({
      total: 1000,
      used: 900,
      available: 250,
    } as Awaited<ReturnType<typeof si.mem>>);
    statfsMock.mockResolvedValue({
      blocks: 1000,
      bfree: 825,
    } as Awaited<ReturnType<typeof fs.promises.statfs>>);
    uptimeMock.mockReturnValue(90061.9);

    await expect(readSystemStatus(createService())).resolves.toEqual({
      cpu: 64.4,
      memory: 75,
      disk: 17.5,
      uptime: 90061,
    });
    expect(statfsMock).toHaveBeenCalledWith(
      path.join('/data', 'rustdesk-console.db'),
    );
  });

  it('queries the database filesystem directly', async () => {
    process.env.DATA_DIR = '/data';
    currentLoadMock.mockResolvedValue({
      currentLoad: 10,
    } as Awaited<ReturnType<typeof si.currentLoad>>);
    memMock.mockResolvedValue({
      total: 1000,
      used: 800,
      available: 400,
    } as Awaited<ReturnType<typeof si.mem>>);
    statfsMock.mockResolvedValue({
      blocks: 1000,
      bfree: 800,
    } as Awaited<ReturnType<typeof fs.promises.statfs>>);
    uptimeMock.mockReturnValue(3600);

    await expect(readSystemStatus(createService())).resolves.toEqual({
      cpu: 10,
      memory: 60,
      disk: 20,
      uptime: 3600,
    });
    expect(statfsMock).toHaveBeenCalledWith(
      path.join('/data', 'rustdesk-console.db'),
    );
  });

  it('keeps successful metrics when one collector fails', async () => {
    currentLoadMock.mockResolvedValue({
      currentLoad: 25,
    } as Awaited<ReturnType<typeof si.currentLoad>>);
    memMock.mockResolvedValue({
      total: 1000,
      available: 500,
    } as Awaited<ReturnType<typeof si.mem>>);
    statfsMock.mockRejectedValue(new Error('Filesystem unavailable'));
    uptimeMock.mockReturnValue(7200);

    await expect(readSystemStatus(createService())).resolves.toEqual({
      cpu: 25,
      memory: 50,
      disk: null,
      uptime: 7200,
    });
  });

  it('returns null for invalid collector values', async () => {
    currentLoadMock.mockResolvedValue({
      currentLoad: Number.NaN,
    } as Awaited<ReturnType<typeof si.currentLoad>>);
    memMock.mockResolvedValue({
      total: 0,
      available: 0,
    } as Awaited<ReturnType<typeof si.mem>>);
    statfsMock.mockResolvedValue({
      blocks: 0,
      bfree: 0,
    } as Awaited<ReturnType<typeof fs.promises.statfs>>);
    uptimeMock.mockImplementation(() => {
      throw new Error('Uptime unavailable');
    });

    await expect(readSystemStatus(createService())).resolves.toEqual({
      cpu: null,
      memory: null,
      disk: null,
      uptime: null,
    });
  });
});
