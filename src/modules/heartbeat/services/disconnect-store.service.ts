import { Injectable } from '@nestjs/common';

/**
 * 断开连接内存存储服务
 * 暂存需要强制断开的连接ID，持续下发给客户端直到连接确实断开
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
   * 获取待断开连接列表（不清除）
   * 每次心跳时调用，持续返回直到客户端确认断开（不再上报该connId）
   * @param deviceUuid 设备UUID
   * @returns 需要断开的连接ID列表，无则返回空数组
   */
  getPendingDisconnects(deviceUuid: string): number[] {
    const pending = this.store.get(deviceUuid);
    return pending ? Array.from(pending) : [];
  }

  /**
   * 移除已断开的连接
   * 客户端心跳上报的 conns 中不再包含的 connId，说明已成功断开，从待断开列表中移除
   * @param deviceUuid 设备UUID
   * @param currentConns 客户端当前上报的活跃连接ID列表
   */
  removeDisconnected(deviceUuid: string, currentConns: number[]): void {
    const pending = this.store.get(deviceUuid);
    if (!pending || pending.size === 0) return;

    const currentSet = new Set(currentConns);
    for (const connId of pending) {
      // 客户端不再上报该连接，说明已断开
      if (!currentSet.has(connId)) {
        pending.delete(connId);
      }
    }

    // 如果待断开列表为空，清理 Map 条目
    if (pending.size === 0) {
      this.store.delete(deviceUuid);
    }
  }
}
