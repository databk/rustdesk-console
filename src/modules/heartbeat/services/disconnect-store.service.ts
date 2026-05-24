import { Injectable } from '@nestjs/common';

/**
 * 断开连接内存存储服务
 * 暂存需要强制断开的连接ID，等待客户端下次心跳时取走
 */
@Injectable()
export class DisconnectStoreService {
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
    if (connIds.length === 0) return;

    const existing = this.store.get(deviceUuid);
    if (existing) {
      for (const connId of connIds) {
        existing.add(connId);
      }
    } else {
      this.store.set(deviceUuid, new Set(connIds));
    }
  }

  /**
   * 获取并清除待断开连接
   * 客户端心跳时调用，取走后即清空，避免重复下发
   * @param deviceUuid 设备UUID
   * @returns 需要断开的连接ID列表，无则返回空数组
   */
  consumePendingDisconnects(deviceUuid: string): number[] {
    const pending = this.store.get(deviceUuid);
    if (!pending || pending.size === 0) {
      return [];
    }

    const result = Array.from(pending);
    this.store.delete(deviceUuid);
    return result;
  }

  /**
   * 获取设备当前的待断开连接（不清除）
   * @param deviceUuid 设备UUID
   */
  getPendingDisconnects(deviceUuid: string): number[] {
    const pending = this.store.get(deviceUuid);
    return pending ? Array.from(pending) : [];
  }
}
