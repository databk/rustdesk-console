import { applyPeerSort } from './peer-sort';

function createQueryBuilder() {
  const queryBuilder = {
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    addSelect: jest.fn(),
    leftJoin: jest.fn(),
  };
  queryBuilder.orderBy.mockReturnValue(queryBuilder);
  queryBuilder.addOrderBy.mockReturnValue(queryBuilder);
  queryBuilder.addSelect.mockReturnValue(queryBuilder);
  queryBuilder.leftJoin.mockReturnValue(queryBuilder);
  return queryBuilder;
}

describe('applyPeerSort', () => {
  it('falls back to ascending device ID when no sort is requested', () => {
    const queryBuilder = createQueryBuilder();

    applyPeerSort(queryBuilder as never, undefined, undefined, 'dg');

    expect(queryBuilder.orderBy).toHaveBeenCalledWith('peer.id', 'ASC');
    expect(queryBuilder.addOrderBy).not.toHaveBeenCalled();
    expect(queryBuilder.leftJoin).not.toHaveBeenCalled();
  });

  it('sorts by ID without an extra select or tie-breaker', () => {
    const queryBuilder = createQueryBuilder();

    applyPeerSort(queryBuilder as never, 'id', 'desc', 'dg');

    expect(queryBuilder.orderBy).toHaveBeenCalledWith('peer.id', 'DESC');
    expect(queryBuilder.addOrderBy).not.toHaveBeenCalled();
    expect(queryBuilder.addSelect).not.toHaveBeenCalled();
  });

  it('joins sysinfos and sorts by hostname through a selected alias', () => {
    const queryBuilder = createQueryBuilder();

    applyPeerSort(queryBuilder as never, 'device_name', 'asc', 'dg');

    expect(queryBuilder.leftJoin).toHaveBeenCalledWith(
      expect.anything(),
      'peer_sort_sysinfo',
      'peer_sort_sysinfo.uuid = peer.uuid',
    );
    expect(queryBuilder.addSelect).toHaveBeenCalledWith(
      'peer_sort_sysinfo.hostname',
      'peer_sort_value',
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('peer_sort_value', 'ASC');
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('peer.id', 'ASC');
  });

  it('joins users and sorts by username', () => {
    const queryBuilder = createQueryBuilder();

    applyPeerSort(queryBuilder as never, 'user_name', 'desc', 'deviceGroup');

    expect(queryBuilder.leftJoin).toHaveBeenCalledWith(
      expect.anything(),
      'peer_sort_user',
      'peer_sort_user.guid = peer.userGuid',
    );
    expect(queryBuilder.addSelect).toHaveBeenCalledWith(
      'peer_sort_user.username',
      'peer_sort_value',
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      'peer_sort_value',
      'DESC',
    );
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('peer.id', 'ASC');
  });

  it('uses the provided device group alias', () => {
    const queryBuilder = createQueryBuilder();

    applyPeerSort(queryBuilder as never, 'device_group_name', 'asc', 'dg');

    expect(queryBuilder.addSelect).toHaveBeenCalledWith(
      'dg.name',
      'peer_sort_value',
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('peer_sort_value', 'ASC');
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('peer.id', 'ASC');
  });

  it('sorts by status and note without joining related tables', () => {
    const statusBuilder = createQueryBuilder();
    applyPeerSort(statusBuilder as never, 'status', 'desc', 'dg');
    expect(statusBuilder.leftJoin).not.toHaveBeenCalled();
    expect(statusBuilder.addSelect).toHaveBeenCalledWith(
      'peer.status',
      'peer_sort_value',
    );
    expect(statusBuilder.orderBy).toHaveBeenCalledWith(
      'peer_sort_value',
      'DESC',
    );

    const noteBuilder = createQueryBuilder();
    applyPeerSort(noteBuilder as never, 'note', 'asc', 'dg');
    expect(noteBuilder.leftJoin).not.toHaveBeenCalled();
    expect(noteBuilder.addSelect).toHaveBeenCalledWith(
      'peer.note',
      'peer_sort_value',
    );
    expect(noteBuilder.orderBy).toHaveBeenCalledWith('peer_sort_value', 'ASC');
  });
});
