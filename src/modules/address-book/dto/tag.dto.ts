import { IsString, IsNumber, IsOptional, IsNotEmpty } from 'class-validator';

/**
 * Data transfer object for adding a tag
 */
export class AddTagDto {
  /**
   * Tag name
   * Used to display and distinguish different tags
   * Tag names must be unique within the same address book
   */
  @IsString()
  @IsNotEmpty()
  name: string;

  /**
   * Tag color
   * ARGB integer value, used for frontend display
   * e.g. 4280391411
   * Default value: 0
   */
  @IsOptional()
  @IsNumber()
  color?: number;
}

/**
 * Data transfer object for updating a tag color
 */
export class UpdateTagDto {
  /**
   * Tag name
   * Used to locate the tag to update
   */
  @IsString()
  @IsNotEmpty()
  name: string;

  /**
   * Tag color
   * ARGB integer value, used for frontend display
   * e.g. 4280391411
   */
  @IsNumber()
  color: number;
}

/**
 * Data transfer object for renaming a tag
 */
export class RenameTagDto {
  /**
   * Old tag name
   * Used to locate the tag to rename
   */
  @IsString()
  @IsNotEmpty()
  old: string;

  /**
   * New tag name
   * The tag name after renaming; must not duplicate an existing tag name in the same address book
   */
  @IsString()
  @IsNotEmpty()
  new: string;
}
