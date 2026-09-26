import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  AddressBook,
  AddressBookTag,
  AddressBookPeerTag,
  ShareRule,
} from '../entities';
import { AddTagDto, UpdateTagDto, RenameTagDto } from '../dto';

@Injectable()
/**
 * AddressBookTagService
 * Sub-service responsible for tag management in the address book
 *
 * Relationship with the main service:
 * Delegated by AddressBookService to handle tag-related operations
 *
 * Call context:
 * Includes adding, updating, deleting, and querying tags
 */
export class AddressBookTagService {
  constructor(
    @InjectRepository(AddressBook)
    private addressBookRepository: Repository<AddressBook>,
    @InjectRepository(AddressBookTag)
    private addressBookTagRepository: Repository<AddressBookTag>,
    @InjectRepository(AddressBookPeerTag)
    private addressBookPeerTagRepository: Repository<AddressBookPeerTag>,
  ) {}

  /**
   * Get the address book tag list
   * Query all tags in the specified address book
   *
   * @param addressBookGuid Address book GUID
   * @param userId User ID (optional, used for permission verification)
   * @param checkAccess Permission check function (optional)
   * @returns Tag list, containing tag names and colors
   */
  async getTags(
    addressBookGuid: string,
    userId?: string,
    checkAccess?: (
      ab: string,
      userId: string,
      rule: ShareRule,
    ) => Promise<AddressBook>,
  ) {
    // If a user ID is provided, verify access permission
    if (userId && checkAccess) {
      await checkAccess(addressBookGuid, userId, ShareRule.READ);
    }

    const tags = await this.addressBookTagRepository.find({
      where: { addressBookGuid },
    });

    return tags.map((t) => ({
      name: t.name,
      color: t.color,
    }));
  }

  /**
   * Get or create a tag
   * Find the tag with the specified name, creating it if it does not exist
   * Mainly used for tag association when adding/updating devices
   *
   * @param addressBookGuid Address book GUID
   * @param tagName Tag name
   * @returns Tag GUID
   */
  async getOrCreateTag(
    addressBookGuid: string,
    tagName: string,
  ): Promise<string> {
    let tag = await this.addressBookTagRepository.findOne({
      where: { name: tagName, addressBookGuid },
    });

    if (!tag) {
      // The tag does not exist, create a new tag
      tag = this.addressBookTagRepository.create({
        guid: uuidv4(),
        addressBookGuid,
        name: tagName,
        color: 0,
      });
      await this.addressBookTagRepository.save(tag);
    }

    return tag.guid;
  }

  /**
   * Add a tag
   * Add a new tag to the specified address book
   *
   * @param addressBookGuid Address book GUID
   * @param dto Tag information DTO, containing the tag name and color
   * @param userId User ID (optional, used for permission verification)
   * @param checkAccess Permission check function (optional)
   * @returns Operation result
   * @throws NotFoundException Thrown when the address book does not exist
   * @throws BadRequestException Thrown when the tag already exists
   */
  async addTag(
    addressBookGuid: string,
    dto: AddTagDto,
    userId?: string,
    checkAccess?: (
      ab: string,
      userId: string,
      rule: ShareRule,
    ) => Promise<AddressBook>,
  ) {
    // If a user ID is provided, verify write permission
    if (userId && checkAccess) {
      await checkAccess(addressBookGuid, userId, ShareRule.READ_WRITE);
    }

    const addressBook = await this.addressBookRepository.findOne({
      where: { guid: addressBookGuid },
    });

    if (!addressBook) {
      throw new NotFoundException('Address book does not exist');
    }

    // Check whether the tag already exists
    const existingTag = await this.addressBookTagRepository.findOne({
      where: { name: dto.name, addressBookGuid },
    });

    if (existingTag) {
      throw new BadRequestException('Tag already exists');
    }

    // Create a new tag
    const tag = this.addressBookTagRepository.create({
      guid: uuidv4(),
      addressBookGuid,
      name: dto.name,
      color: dto.color || 0,
    });

    await this.addressBookTagRepository.save(tag);
    return {};
  }

  /**
   * Rename a tag
   * Change the tag name, checking whether the new name conflicts
   *
   * @param addressBookGuid Address book GUID
   * @param dto Rename information DTO, containing the old and new tag names
   * @param userId User ID (optional, used for permission verification)
   * @param checkAccess Permission check function (optional)
   * @returns Operation result
   * @throws NotFoundException Thrown when the old tag does not exist
   * @throws BadRequestException Thrown when the new tag name already exists
   */
  async renameTag(
    addressBookGuid: string,
    dto: RenameTagDto,
    userId?: string,
    checkAccess?: (
      ab: string,
      userId: string,
      rule: ShareRule,
    ) => Promise<AddressBook>,
  ) {
    // If a user ID is provided, verify write permission
    if (userId && checkAccess) {
      await checkAccess(addressBookGuid, userId, ShareRule.READ_WRITE);
    }

    // Look up the tag by its old name
    const tag = await this.addressBookTagRepository.findOne({
      where: { name: dto.old, addressBookGuid },
    });

    if (!tag) {
      throw new NotFoundException('Tag does not exist');
    }

    // Check whether the new tag name already exists
    const existingTag = await this.addressBookTagRepository.findOne({
      where: { name: dto.new, addressBookGuid },
    });

    if (existingTag) {
      throw new BadRequestException('New tag name already exists');
    }

    // Update the tag name
    await this.addressBookTagRepository.update(
      { guid: tag.guid },
      { name: dto.new },
    );
    return {};
  }

  /**
   * Update the tag color
   * Change the tag color attribute, used for UI display
   *
   * @param addressBookGuid Address book GUID
   * @param dto Tag update information DTO, containing the tag name and new color
   * @param userId User ID (optional, used for permission verification)
   * @param checkAccess Permission check function (optional)
   * @returns Operation result
   * @throws NotFoundException Thrown when the tag does not exist
   */
  async updateTag(
    addressBookGuid: string,
    dto: UpdateTagDto,
    userId?: string,
    checkAccess?: (
      ab: string,
      userId: string,
      rule: ShareRule,
    ) => Promise<AddressBook>,
  ) {
    // If a user ID is provided, verify write permission
    if (userId && checkAccess) {
      await checkAccess(addressBookGuid, userId, ShareRule.READ_WRITE);
    }

    // Look up the tag by name
    const tag = await this.addressBookTagRepository.findOne({
      where: { name: dto.name, addressBookGuid },
    });

    if (!tag) {
      throw new NotFoundException('Tag does not exist');
    }

    // Update the tag color
    await this.addressBookTagRepository.update(
      { guid: tag.guid },
      { color: dto.color },
    );
    return {};
  }

  /**
   * Delete the tags
   * Batch delete tags from the specified address book, also removing all device associations with those tags
   *
   * @param addressBookGuid Address book GUID
   * @param names List of tag names to delete
   * @param userId User ID (optional, used for permission verification)
   * @param checkAccess Permission check function (optional)
   * @returns Operation result
   * @throws BadRequestException Thrown when no tag names are provided
   */
  async deleteTags(
    addressBookGuid: string,
    names: string[],
    userId?: string,
    checkAccess?: (
      ab: string,
      userId: string,
      rule: ShareRule,
    ) => Promise<AddressBook>,
  ) {
    // If a user ID is provided, verify write permission
    if (userId && checkAccess) {
      await checkAccess(addressBookGuid, userId, ShareRule.READ_WRITE);
    }

    if (!names || names.length === 0) {
      throw new BadRequestException('Please provide the tag names to delete');
    }

    // Get the GUIDs of the tags to delete
    const tags = await this.addressBookTagRepository.find({
      where: { name: In(names), addressBookGuid },
    });

    const tagGuids = tags.map((t) => t.guid);

    // First delete the associations between tags and devices
    if (tagGuids.length > 0) {
      await this.addressBookPeerTagRepository.delete({
        tagGuid: In(tagGuids),
      });
    }

    // Delete the tags
    await this.addressBookTagRepository.delete({
      name: In(names),
      addressBookGuid,
    });

    return {};
  }
}
