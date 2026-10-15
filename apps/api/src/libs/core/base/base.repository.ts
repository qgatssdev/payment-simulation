import type {
  DeepPartial,
  EntityManager,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
} from 'typeorm';

/**
 * Thin wrapper over a TypeORM Repository, kept from the nest-template. Subclasses take an
 * EntityManager so the same repository can be rebound to a transaction with
 * withTransaction(manager): every write in a unit of work then shares one connection.
 *
 * Deliberately smaller than the template's version: no generic filterBy/orderBy/search taking
 * column names from the caller. Each repository exposes the specific, indexed queries it
 * supports instead.
 */
export abstract class BaseRepository<T extends ObjectLiteral & { id: string }> {
  protected constructor(protected readonly repository: Repository<T>) {}

  protected get manager(): EntityManager {
    return this.repository.manager;
  }

  withTransaction(manager: EntityManager): this {
    const Ctor = this.constructor as new (manager: EntityManager) => this;
    return new Ctor(manager);
  }

  create(data: DeepPartial<T>): T {
    return this.repository.create(data);
  }

  save(entity: T): Promise<T> {
    return this.repository.save(entity);
  }

  findById(id: string): Promise<T | null> {
    return this.repository.findOneBy({ id } as FindOptionsWhere<T>);
  }

  exists(where: FindOptionsWhere<T>): Promise<boolean> {
    return this.repository.existsBy(where);
  }

  count(where?: FindOptionsWhere<T>): Promise<number> {
    return this.repository.countBy(where ?? {});
  }
}
