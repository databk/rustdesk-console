/**
 * Address book data transfer object module
 * Exports all address book related DTO classes
 */

/** Device DTOs - add and update devices */
export { AddPeerDto, UpdatePeerDto } from './peer.dto';

/** Tag DTOs - add, update, and rename tags */
export { AddTagDto, UpdateTagDto, RenameTagDto } from './tag.dto';

/** Query DTOs - paginated queries and device list queries */
export { PaginationDto, PeersQueryDto, TagMatchMode } from './query.dto';

/** Rule DTOs - rule queries, creation, and updates */
export { RuleQueryDto, CreateRuleDto, UpdateRuleDto } from './rule.dto';

/** Address book profile CRUD DTOs used by the web console. */
export {
  CreateAddressBookProfileDto,
  UpdateAddressBookProfileDto,
  UpdateCustomAddressBookProfileDto,
  DeleteAddressBooksDto,
} from './profile.dto';
