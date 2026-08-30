import 'reflect-metadata';
import { Repository } from 'typeorm';
import { AddressBookLegacyService } from './address-book-legacy.service';
import {
  AddressBook,
  AddressBookPeer,
  AddressBookPeerTag,
  AddressBookTag,
} from '../entities';
import { Sysinfo, Peer } from '../../../common/entities';

jest.mock('uuid', () => {
  const cryptoModule =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { v4: cryptoModule.randomUUID };
});

type MockRepository = {
  findOne: jest.Mock;
  find: jest.Mock;
  delete: jest.Mock;
};

const repository = (): MockRepository => ({
  findOne: jest.fn(),
  find: jest.fn(),
  delete: jest.fn().mockResolvedValue({ affected: 0 }),
});

describe('AddressBookLegacyService', () => {
  it("does not delete peer tags belonging to another user's address book", async () => {
    const addressBookRepository = repository();
    const addressBookPeerRepository = repository();
    const addressBookTagRepository = repository();
    const addressBookPeerTagRepository = repository();
    const sysinfoRepository = repository();
    const peerRepository = repository();

    addressBookRepository.findOne.mockResolvedValue({
      guid: 'book-a',
      owner: 'user-a',
      isPersonal: true,
    });
    addressBookPeerRepository.find.mockResolvedValue([{ guid: 'entry-a' }]);

    const service = new AddressBookLegacyService(
      addressBookRepository as unknown as Repository<AddressBook>,
      addressBookPeerRepository as unknown as Repository<AddressBookPeer>,
      addressBookTagRepository as unknown as Repository<AddressBookTag>,
      addressBookPeerTagRepository as unknown as Repository<AddressBookPeerTag>,
      sysinfoRepository as unknown as Repository<Sysinfo>,
      peerRepository as unknown as Repository<Peer>,
    );

    await service.updateLegacyAddressBook(
      'user-a',
      JSON.stringify({ tags: [], peers: [] }),
    );

    expect(addressBookPeerTagRepository.delete).toHaveBeenCalledTimes(1);
    const criteria = addressBookPeerTagRepository.delete.mock.calls[0][0] as {
      peerGuid: { value: string[] };
    };
    expect(criteria.peerGuid.value).toEqual(['entry-a']);
    expect(addressBookPeerTagRepository.delete).not.toHaveBeenCalledWith({});
    expect(addressBookTagRepository.delete).toHaveBeenCalledWith({
      addressBookGuid: 'book-a',
    });
    expect(addressBookPeerRepository.delete).toHaveBeenCalledWith({
      addressBookGuid: 'book-a',
    });
  });
});
