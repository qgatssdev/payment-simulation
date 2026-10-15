import type { NamingStrategyInterface, Table } from 'typeorm';
import { DefaultNamingStrategy } from 'typeorm';

export function snakeCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function tableNameOf(tableOrName: Table | string): string {
  const name = typeof tableOrName === 'string' ? tableOrName : tableOrName.name;
  return name.split('.').pop() ?? name;
}

/**
 * snake_case columns and short, readable constraint names (pk_payments, fk_jobs_payment_id)
 * instead of TypeORM's hashed defaults, so hand-written migrations and the entity metadata
 * agree on every name and a schema-drift check can compare them exactly.
 */
export class SnakeNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  override tableName(className: string, customName?: string): string {
    return customName ?? snakeCase(className);
  }

  override columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    return snakeCase([...embeddedPrefixes, customName ?? propertyName].join('_'));
  }

  override relationName(propertyName: string): string {
    return snakeCase(propertyName);
  }

  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return snakeCase(`${relationName}_${referencedColumnName}`);
  }

  override primaryKeyName(tableOrName: Table | string): string {
    return `pk_${tableNameOf(tableOrName)}`;
  }

  override foreignKeyName(tableOrName: Table | string, columnNames: string[]): string {
    return `fk_${tableNameOf(tableOrName)}_${columnNames.join('_')}`;
  }

  override indexName(tableOrName: Table | string, columnNames: string[]): string {
    return `idx_${tableNameOf(tableOrName)}_${columnNames.join('_')}`;
  }

  override uniqueConstraintName(
    tableOrName: Table | string,
    columnNames: string[],
  ): string {
    return `uq_${tableNameOf(tableOrName)}_${columnNames.join('_')}`;
  }
}
