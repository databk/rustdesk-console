import {
  USER_GROUP_DEFAULT_KEY_COLUMN,
  USER_GROUP_DEFAULT_KEY_INDEX,
  withoutManagedColumns,
} from './schema-diff';

describe('withoutManagedColumns', () => {
  const metadataDelete = {
    query:
      'DELETE FROM `db`.`typeorm_metadata` WHERE `type` = ? AND `name` = ? AND `schema` = ? AND `table` = ?',
  };

  it('removes statements about the managed user_groups column and index', () => {
    const queries = [
      {
        query: `DROP INDEX \`${USER_GROUP_DEFAULT_KEY_INDEX}\` ON \`user_groups\``,
      },
      {
        query: `ALTER TABLE \`user_groups\` DROP COLUMN \`${USER_GROUP_DEFAULT_KEY_COLUMN}\``,
      },
      {
        ...metadataDelete,
        parameters: [
          'GENERATED_COLUMN',
          USER_GROUP_DEFAULT_KEY_COLUMN,
          'db',
          'user_groups',
        ],
      },
    ];

    expect(withoutManagedColumns(queries)).toEqual([]);
  });

  it('keeps an identically named column on another table', () => {
    const queries = [
      {
        query: `ALTER TABLE \`strategies\` DROP COLUMN \`${USER_GROUP_DEFAULT_KEY_COLUMN}\``,
      },
      {
        ...metadataDelete,
        parameters: [
          'GENERATED_COLUMN',
          USER_GROUP_DEFAULT_KEY_COLUMN,
          'db',
          'strategies',
        ],
      },
      { query: 'ALTER TABLE `user_groups` ADD COLUMN `note` text NULL' },
      {
        query: `DROP INDEX \`IDX_user_groups_name\` ON \`user_groups\``,
      },
    ];

    expect(withoutManagedColumns(queries)).toEqual(queries);
  });
});
