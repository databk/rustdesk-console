import { ForbiddenException } from '@nestjs/common';
import { WebClientController } from './web-client.controller';
import { WebClientSessionService } from './web-client-session.service';
import { WebClientGateway } from './web-client.gateway';
import { WebClientService } from './web-client.service';
import { WebClientAuthorizationService } from './web-client-authorization.service';
import { PeerService } from '../device-group/peer.service';
import { unavailable } from '../../../network/tcp-observation.js';

jest.mock('uuid', () => ({
  v4: jest.requireActual<typeof import('node:crypto')>('node:crypto')
    .randomUUID,
}));
describe('session-scoped TCP endpoint', () => {
  const actor = { id: 'owner', jti: 'login' };
  const guid = '00000000-0000-4000-8000-000000000001';
  const owned = jest.fn();
  const observe = jest.fn();
  const controller = new WebClientController(
    {} as WebClientService,
    {} as WebClientAuthorizationService,
    {} as PeerService,
    { requireOwnedActive: owned } as unknown as WebClientSessionService,
    { observeNetwork: observe } as unknown as WebClientGateway,
  );
  beforeEach(() => {
    owned.mockReset().mockResolvedValue(undefined);
    observe.mockReset().mockResolvedValue({
      api_version: 1,
      session_guid: guid,
      entry: unavailable('connection', 'proxy_unobservable'),
      relay: unavailable('connection', 'namespace_unobservable'),
    });
  });
  it('does not collect data if ownership/current role/device scope validation fails', async () => {
    owned.mockRejectedValue(new ForbiddenException());
    await expect(
      controller.getSessionNetwork(actor, guid),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(observe).not.toHaveBeenCalled();
  });
  it('revalidates after collection so delayed results cannot survive revocation', async () => {
    owned
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(
      controller.getSessionNetwork(actor, guid),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(observe).toHaveBeenCalledWith(guid);
    expect(owned).toHaveBeenCalledTimes(2);
  });
  it('returns only the bound session, retaining independent failure reasons', async () => {
    const result = await controller.getSessionNetwork(actor, guid);
    expect(result.entry.reason).toBe('proxy_unobservable');
    expect(result.relay.reason).toBe('namespace_unobservable');
    expect(owned).toHaveBeenNthCalledWith(1, actor, guid);
    expect(owned).toHaveBeenNthCalledWith(2, actor, guid);
  });
});
