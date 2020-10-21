import { Collection, EntityManager, LockMode, MikroORM, QueryOrder, Logger, ValidationError, wrap } from '@mikro-orm/core';
import { SqliteDriver } from '@mikro-orm/sqlite';
import { initORMSqlite2, wipeDatabaseSqlite2 } from './bootstrap';
import { Author4, Book4, BookTag4, FooBar4, IAuthor4, IPublisher4, Publisher4, PublisherType, Test4 } from './entities-schema';

describe('EntityManagerSqlite2', () => {

  let orm: MikroORM<SqliteDriver>;

  beforeAll(async () => orm = await initORMSqlite2());
  beforeEach(async () => wipeDatabaseSqlite2(orm.em));

  test('isConnected()', async () => {
    expect(await orm.isConnected()).toBe(true);
    await orm.close(true);
    expect(await orm.isConnected()).toBe(false);
    await orm.connect();
    expect(await orm.isConnected()).toBe(true);

    // as the db lives only in memory, we need to re-create the schema after reconnection
    await orm.getSchemaGenerator().createSchema();
  });

  test('should convert entity to PK when trying to search by entity', async () => {
    const repo = orm.em.getRepository(Author4);
    const author = orm.em.create(Author4, { name: 'name', email: 'email' });
    await repo.persistAndFlush(author);
    const a = await repo.findOne(author);
    const authors = await repo.find({ id: author.id });
    expect(a).toBe(author);
    expect(authors[0]).toBe(author);
  });

  test('transactions', async () => {
    const god1 = orm.em.create(Author4, { name: 'God1', email: 'hello@heaven1.god' });

    try {
      await orm.em.transactional(async em => {
        await em.persistAndFlush(god1);
        throw new Error(); // rollback the transaction
      });
    } catch { }

    const res1 = await orm.em.findOne(Author4, { name: 'God1' });
    expect(res1).toBeNull();

    const ret = await orm.em.transactional(async em => {
      const god2 = orm.em.create(Author4, { name: 'God2', email: 'hello@heaven2.god' });
      await em.persist(god2);
      return true;
    });

    const res2 = await orm.em.findOne(Author4, { name: 'God2' });
    expect(res2).not.toBeNull();
    expect(ret).toBe(true);

    const err = new Error('Test');

    try {
      await orm.em.transactional(async em => {
        const god3 = orm.em.create(Author4, { name: 'God4', email: 'hello@heaven4.god' });
        await em.persist(god3);
        throw err;
      });
    } catch (e) {
      expect(e).toBe(err);
      const res3 = await orm.em.findOne(Author4, { name: 'God4' });
      expect(res3).toBeNull();
    }
  });

  test('nested transactions with save-points', async () => {
    await orm.em.transactional(async em => {
      const god1 = orm.em.create(Author4, { name: 'God1', email: 'hello1@heaven.god' });

      try {
        await em.transactional(async em2 => {
          await em2.persistAndFlush(god1);
          throw new Error(); // rollback the transaction
        });
      } catch { }

      const res1 = await em.findOne(Author4, { name: 'God1' });
      expect(res1).toBeNull();

      await em.transactional(async em2 => {
        const god2 = orm.em.create(Author4, { name: 'God2', email: 'hello2@heaven.god' });
        await em2.persistAndFlush(god2);
      });

      const res2 = await em.findOne(Author4, { name: 'God2' });
      expect(res2).not.toBeNull();
    });
  });

  test('nested transaction rollback with save-points will commit the outer one', async () => {
    const mock = jest.fn();
    const logger = new Logger(mock, ['query']);
    Object.assign(orm.config, { logger });

    // start outer transaction
    const transaction = orm.em.transactional(async em => {
      // do stuff inside inner transaction and rollback
      try {
        await em.transactional(async em2 => {
          await em2.persistAndFlush(orm.em.create(Author4, { name: 'God', email: 'hello@heaven.god' }));
          throw new Error(); // rollback the transaction
        });
      } catch { }

      await em.persistAndFlush(orm.em.create(Author4, { name: 'God Persisted!', email: 'hello-persisted@heaven.god' }));
    });

    // try to commit the outer transaction
    await expect(transaction).resolves.toBeUndefined();
    expect(mock.mock.calls.length).toBe(6);
    expect(mock.mock.calls[0][0]).toMatch('begin');
    expect(mock.mock.calls[1][0]).toMatch('savepoint trx');
    expect(mock.mock.calls[2][0]).toMatch('insert into `author4` (`created_at`, `email`, `name`, `terms_accepted`, `updated_at`) values (?, ?, ?, ?, ?)');
    expect(mock.mock.calls[3][0]).toMatch('rollback to savepoint trx');
    expect(mock.mock.calls[4][0]).toMatch('insert into `author4` (`created_at`, `email`, `name`, `terms_accepted`, `updated_at`) values (?, ?, ?, ?, ?)');
    expect(mock.mock.calls[5][0]).toMatch('commit');
    await expect(orm.em.findOne(Author4, { name: 'God Persisted!' })).resolves.not.toBeNull();
  });

  test('should load entities', async () => {
    expect(orm).toBeInstanceOf(MikroORM);
    expect(orm.em).toBeInstanceOf(EntityManager);

    const god = orm.em.create(Author4, { name: 'God', email: 'hello@heaven.god' });
    const bible = orm.em.create(Book4, { title: 'Bible', author: god });
    expect(bible.author).toBe(god);
    bible.author = god;
    await orm.em.persistAndFlush(bible);

    const author = orm.em.create(Author4, { name: 'Jon Snow', email: 'snow@wall.st' });
    author.born = new Date('1990-03-23');
    author.favouriteBook = bible;

    const publisher = orm.em.create(Publisher4, { name: '7K publisher', type: PublisherType.GLOBAL });
    const book1 = orm.em.create(Book4, { title: 'My Life on The Wall, part 1', author });
    book1.publisher = wrap(publisher).toReference();
    book1.author = author;
    const book2 = orm.em.create(Book4, { title: 'My Life on The Wall, part 2', author });
    book2.publisher = wrap(publisher).toReference();
    book2.author = author;
    const book3 = orm.em.create(Book4, { title: 'My Life on The Wall, part 3', author });
    book3.publisher = wrap(publisher).toReference();
    book3.author = author;

    const repo = orm.em.getRepository(Book4);
    repo.persist(book1);
    repo.persist(book2);
    repo.persist(book3);
    await repo.flush();
    orm.em.clear();

    const publisher7k = (await orm.em.getRepository(Publisher4).findOne({ name: '7K publisher' }))!;
    expect(publisher7k).not.toBeNull();
    expect(publisher7k.tests).toBeInstanceOf(Collection);
    expect(publisher7k.tests.isInitialized()).toBe(false);
    orm.em.clear();

    const authorRepository = orm.em.getRepository(Author4);
    const booksRepository = orm.em.getRepository(Book4);
    const books = await booksRepository.findAll(['author']);
    expect(wrap(books[0].author).isInitialized()).toBe(true);
    expect(await authorRepository.findOne({ favouriteBook: bible.id })).not.toBe(null);
    orm.em.clear();

    const noBooks = await booksRepository.find({ title: 'not existing' }, ['author']);
    expect(noBooks.length).toBe(0);
    orm.em.clear();

    const jon = (await authorRepository.findOne({ name: 'Jon Snow' }, ['books', 'favouriteBook']))!;
    const authors = await authorRepository.findAll(['books', 'favouriteBook']);
    expect(await authorRepository.findOne({ email: 'not existing' })).toBeNull();

    // full text search test
    const fullTextBooks = (await booksRepository.find({ title: { $fulltext: 'on the Wa' }}))!;
    expect(fullTextBooks.length).toBe(3);

    // count test
    const count = await authorRepository.count();
    expect(count).toBe(authors.length);

    // identity map test
    authors.shift(); // shift the god away, as that entity is detached from IM
    expect(jon).toBe(authors[0]);
    expect(jon).toBe(await authorRepository.findOne(jon.id));

    // serialization test
    const o = wrap(jon).toJSON();
    expect(o).toMatchObject({
      id: jon.id,
      createdAt: jon.createdAt,
      updatedAt: jon.updatedAt,
      books: [
        { author: jon.id, publisher: publisher.id, title: 'My Life on The Wall, part 1' },
        { author: jon.id, publisher: publisher.id, title: 'My Life on The Wall, part 2' },
        { author: jon.id, publisher: publisher.id, title: 'My Life on The Wall, part 3' },
      ],
      favouriteBook: { author: god.id, title: 'Bible' },
      born: '1990-03-23',
      email: 'snow@wall.st',
      name: 'Jon Snow',
    });
    expect(wrap(jon).toJSON()).toEqual(o);
    expect(jon.books.getIdentifiers()).toBeInstanceOf(Array);
    expect(typeof jon.books.getIdentifiers()[0]).toBe('number');

    for (const author of authors) {
      expect(author.books).toBeInstanceOf(Collection);
      expect(author.books.isInitialized()).toBe(true);

      // iterator test
      for (const book of author.books.$) {
        expect(book.title).toMatch(/My Life on The Wall, part \d/);

        expect(book.author.constructor.name).toBe('Author4');
        expect(wrap(book.author).isInitialized()).toBe(true);
        expect(book.publisher!.unwrap().constructor.name).toBe('Publisher4');
        expect(wrap(book.publisher).isInitialized()).toBe(false);
      }
    }

    const booksByTitleAsc = await booksRepository.find({ author: jon.id }, [], { title: QueryOrder.ASC });
    expect(booksByTitleAsc[0].title).toBe('My Life on The Wall, part 1');
    expect(booksByTitleAsc[1].title).toBe('My Life on The Wall, part 2');
    expect(booksByTitleAsc[2].title).toBe('My Life on The Wall, part 3');

    const booksByTitleDesc = await booksRepository.find({ author: jon.id }, [], { title: QueryOrder.DESC });
    expect(booksByTitleDesc[0].title).toBe('My Life on The Wall, part 3');
    expect(booksByTitleDesc[1].title).toBe('My Life on The Wall, part 2');
    expect(booksByTitleDesc[2].title).toBe('My Life on The Wall, part 1');

    const twoBooks = await booksRepository.find({ author: jon.id }, [], { title: QueryOrder.DESC }, 2);
    expect(twoBooks.length).toBe(2);
    expect(twoBooks[0].title).toBe('My Life on The Wall, part 3');
    expect(twoBooks[1].title).toBe('My Life on The Wall, part 2');

    const lastBook = await booksRepository.find({ author: jon.id }, ['author'], { title: QueryOrder.DESC }, 2, 2);
    expect(lastBook.length).toBe(1);
    expect(lastBook[0].title).toBe('My Life on The Wall, part 1');
    expect(lastBook[0].author.constructor.name).toBe('Author4');
    expect(wrap(lastBook[0].author).isInitialized()).toBe(true);
    await orm.em.getRepository(Book4).remove(lastBook[0]).flush();
  });

  test('findOne should initialize entity that is already in IM', async () => {
    const god = orm.em.create(Author4, { name: 'God', email: 'hello@heaven.god' });
    const bible = orm.em.create(Book4, { title: 'Bible', author: god });
    await orm.em.persist(bible).flush();
    orm.em.clear();

    const ref = orm.em.getReference(Author4, god.id);
    expect(wrap(ref).isInitialized()).toBe(false);
    const newGod = await orm.em.findOne(Author4, god.id);
    expect(ref).toBe(newGod);
    expect(wrap(ref).isInitialized()).toBe(true);
  });

  test('findOne supports regexps', async () => {
    const author1 = orm.em.create(Author4, { name: 'Author 1', email: 'a1@example.com' });
    const author2 = orm.em.create(Author4, { name: 'Author 2', email: 'a2@example.com' });
    const author4 = orm.em.create(Author4, { name: 'Author 3', email: 'a3@example.com' });
    await orm.em.persist([author1, author2, author4]).flush();
    orm.em.clear();

    const authors = await orm.em.find(Author4, { email: /exa.*le\.c.m$/ });
    expect(authors.length).toBe(3);
    expect(authors[0].name).toBe('Author 1');
    expect(authors[1].name).toBe('Author 2');
    expect(authors[2].name).toBe('Author 3');
  });

  test('findOne supports optimistic locking [testMultipleFlushesDoIncrementalUpdates]', async () => {
    const test = orm.em.create(Test4, {});

    for (let i = 0; i < 5; i++) {
      test.name = 'test' + i;
      await orm.em.persistAndFlush(test);
      expect(typeof test.version).toBe('number');
      expect(test.version).toBe(i + 1);
    }
  });

  test('findOne supports optimistic locking [testStandardFailureThrowsException]', async () => {
    const test = orm.em.create(Test4, {});
    test.name = 'test';
    await orm.em.persistAndFlush(test);
    expect(typeof test.version).toBe('number');
    expect(test.version).toBe(1);
    orm.em.clear();

    const test2 = await orm.em.findOne(Test4, test.id);
    await orm.em.nativeUpdate('Test4', { id: test.id }, { name: 'Changed!' }); // simulate concurrent update
    test2!.name = 'WHATT???';

    try {
      await orm.em.flush();
      expect(1).toBe('should be unreachable');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect(e.message).toBe(`The optimistic lock on entity Test4 failed`);
      expect((e as ValidationError).getEntity()).toBe(test2);
    }
  });

  test('findOne supports optimistic locking [versioned proxy]', async () => {
    const test = orm.em.create(Test4, {});
    test.name = 'test';
    await orm.em.persistAndFlush(test);
    orm.em.clear();

    const proxy = orm.em.getReference(Test4, test.id);
    await orm.em.lock(proxy, LockMode.OPTIMISTIC, 1);
    expect(wrap(proxy).isInitialized()).toBe(true);
  });

  test('findOne supports optimistic locking [versioned proxy]', async () => {
    const test = orm.em.create(Test4, {});
    test.name = 'test';
    await orm.em.persistAndFlush(test);
    orm.em.clear();

    const test2 = await orm.em.findOne(Test4, test.id);
    await orm.em.lock(test2!, LockMode.OPTIMISTIC, test.version);
  });

  test('findOne supports optimistic locking [testOptimisticTimestampLockFailureThrowsException]', async () => {
    const tag = orm.em.create(BookTag4, { name: 'Testing' });
    expect(tag.version).toBeUndefined();
    await orm.em.persistAndFlush(tag);
    expect(tag.version).toBeInstanceOf(Date);
    orm.em.clear();

    const tag2 = (await orm.em.findOne(BookTag4, tag.id))!;
    expect(tag2.version).toBeInstanceOf(Date);

    try {
      // Try to lock the record with an older timestamp and it should throw an exception
      const expectedVersionExpired = new Date(+tag2.version - 3600);
      await orm.em.lock(tag2, LockMode.OPTIMISTIC, expectedVersionExpired);
      expect(1).toBe('should be unreachable');
    } catch (e) {
      expect((e as ValidationError).getEntity()).toBe(tag2);
    }
  });

  test('findOne supports optimistic locking [unversioned entity]', async () => {
    const author = orm.em.create(Author4, { name: 'name', email: 'email' });
    await orm.em.persistAndFlush(author);
    await expect(orm.em.lock(author, LockMode.OPTIMISTIC)).rejects.toThrowError('Cannot obtain optimistic lock on unversioned entity Author4');
  });

  test('findOne supports optimistic locking [versioned entity]', async () => {
    const test = orm.em.create(Test4, {});
    test.name = 'test';
    await orm.em.persistAndFlush(test);
    await orm.em.lock(test, LockMode.OPTIMISTIC, test.version);
  });

  test('findOne supports optimistic locking [version mismatch]', async () => {
    const test = orm.em.create(Test4, {});
    test.name = 'test';
    await orm.em.persistAndFlush(test);
    await expect(orm.em.lock(test, LockMode.OPTIMISTIC, test.version + 1)).rejects.toThrowError('The optimistic lock failed, version 2 was expected, but is actually 1');
  });

  test('findOne supports optimistic locking [testLockUnmanagedEntityThrowsException]', async () => {
    const test = orm.em.create(Test4, {});
    test.name = 'test';
    await expect(orm.em.lock(test, LockMode.OPTIMISTIC)).rejects.toThrowError('Entity Test4 is not managed. An entity is managed if its fetched from the database or registered as new through EntityManager.persist()');
  });

  test('pessimistic locking requires active transaction', async () => {
    const test = orm.em.create(Test4, { name: 'Lock test' });
    await orm.em.persistAndFlush(test);
    await expect(orm.em.findOne(Test4, test.id, { lockMode: LockMode.PESSIMISTIC_READ })).rejects.toThrowError('An open transaction is required for this operation');
    await expect(orm.em.findOne(Test4, test.id, { lockMode: LockMode.PESSIMISTIC_WRITE })).rejects.toThrowError('An open transaction is required for this operation');
    await expect(orm.em.lock(test, LockMode.PESSIMISTIC_READ)).rejects.toThrowError('An open transaction is required for this operation');
    await expect(orm.em.lock(test, LockMode.PESSIMISTIC_WRITE)).rejects.toThrowError('An open transaction is required for this operation');
  });

  test('findOne does not support pessimistic locking [pessimistic write]', async () => {
    const author = orm.em.create(Author4, { name: 'name', email: 'email' });
    await orm.em.persistAndFlush(author);

    const mock = jest.fn();
    const logger = new Logger(mock, ['query']);
    Object.assign(orm.config, { logger });

    await orm.em.transactional(async em => {
      await em.lock(author, LockMode.PESSIMISTIC_WRITE);
    });

    expect(mock.mock.calls.length).toBe(3);
    expect(mock.mock.calls[0][0]).toMatch('begin');
    expect(mock.mock.calls[1][0]).toMatch('select 1 from `author4` as `e0` where `e0`.`id` = ?');
    expect(mock.mock.calls[2][0]).toMatch('commit');
  });

  test('findOne does not support pessimistic locking [pessimistic read]', async () => {
    const author = orm.em.create(Author4, { name: 'name', email: 'email' });
    await orm.em.persistAndFlush(author);

    const mock = jest.fn();
    const logger = new Logger(mock, ['query']);
    Object.assign(orm.config, { logger });

    await orm.em.transactional(async em => {
      await em.lock(author, LockMode.PESSIMISTIC_READ);
    });

    expect(mock.mock.calls.length).toBe(3);
    expect(mock.mock.calls[0][0]).toMatch('begin');
    expect(mock.mock.calls[1][0]).toMatch('select 1 from `author4` as `e0` where `e0`.`id` = ?');
    expect(mock.mock.calls[2][0]).toMatch('commit');
  });

  test('stable results of serialization', async () => {
    const god = orm.em.create(Author4, { name: 'God', email: 'hello@heaven.god' });
    const bible = orm.em.create(Book4, { title: 'Bible', author: god });
    const bible2 = orm.em.create(Book4, { title: 'Bible pt. 2', author: god });
    const bible3 = orm.em.create(Book4, { title: 'Bible pt. 3', author: orm.em.create(Author4, { name: 'Lol', email: 'lol@lol.lol' }) });
    await orm.em.persist([bible, bible2, bible3]).flush();
    orm.em.clear();

    const newGod = (await orm.em.findOne(Author4, god.id))!;
    const books = await orm.em.find(Book4, {});
    await wrap(newGod).init(false);

    for (const book of books) {
      expect(wrap(book).toJSON()).toMatchObject({
        author: book.author.id,
      });
    }
  });

  test('stable results of serialization (collection)', async () => {
    const pub = orm.em.create(Publisher4, { name: 'Publisher4' });
    await orm.em.persist(pub).flush();
    const god = orm.em.create(Author4, { name: 'God', email: 'hello@heaven.god' });
    const bible = orm.em.create(Book4, { title: 'Bible', author: god });
    bible.publisher = wrap(pub).toReference();
    const bible2 = orm.em.create(Book4, { title: 'Bible pt. 2', author: god });
    bible2.publisher = wrap(pub).toReference();
    const bible3 = orm.em.create(Book4, { title: 'Bible pt. 3', author: orm.em.create(Author4, { name: 'Lol', email: 'lol@lol.lol' }) });
    bible3.publisher = wrap(pub).toReference();
    await orm.em.persist([bible, bible2, bible3]).flush();
    orm.em.clear();

    const newGod = orm.em.getReference(Author4, god.id);
    const publisher = await orm.em.findOneOrFail<IPublisher4>('Publisher4', pub.id, { populate: ['books'] });
    await wrap(newGod).init();

    const json = wrap(publisher).toJSON().books!;

    for (const book of publisher.books) {
      expect(json.find((b: any) => b.id === book.id)).toMatchObject({
        author: book.author.id,
      });
    }
  });

  test('json properties', async () => {
    const god = orm.em.create(Author4, { name: 'God', email: 'hello@heaven.god' });
    god.identities = ['fb-123', 'pw-231', 'tw-321'];
    const bible = orm.em.create(Book4, { title: 'Bible', author: god });
    bible.meta = { category: 'god like', items: 3 };
    await orm.em.persistAndFlush(bible);
    orm.em.clear();

    const g = (await orm.em.findOne(Author4, god.id, ['books']))!;
    expect(Array.isArray(g.identities)).toBe(true);
    expect(g.identities).toEqual(['fb-123', 'pw-231', 'tw-321']);
    expect(typeof g.books[0].meta).toBe('object');
    expect(g.books[0].meta).toEqual({ category: 'god like', items: 3 });
  });

  test('findOne by id', async () => {
    const authorRepository = orm.em.getRepository(Author4);
    const jon = orm.em.create(Author4, { name: 'Jon Snow', email: 'snow@wall.st' });
    await authorRepository.persistAndFlush(jon);

    orm.em.clear();
    let author = (await authorRepository.findOne(jon.id))!;
    expect(author).not.toBeNull();
    expect(author.name).toBe('Jon Snow');

    orm.em.clear();
    author = (await authorRepository.findOne({ id: jon.id }))!;
    expect(author).not.toBeNull();
    expect(author.name).toBe('Jon Snow');
  });

  test('populate ManyToOne relation', async () => {
    const authorRepository = orm.em.getRepository(Author4);
    const god = orm.em.create(Author4, { name: 'God', email: 'hello@heaven.god' });
    const bible = orm.em.create(Book4, { title: 'Bible', god });
    await orm.em.persist(bible).flush();

    const jon = orm.em.create(Author4, { name: 'Jon Snow', email: 'snow@wall.st' });
    jon.born = new Date('1990-03-23');
    jon.favouriteBook = bible;
    await orm.em.persist(jon).flush();
    orm.em.clear();

    const jon2 = await authorRepository.findOneOrFail(jon.id);
    expect(jon2).not.toBeNull();
    expect(jon2.name).toBe('Jon Snow');
    expect(jon2.favouriteBook!.constructor.name).toBe('Book4');
    expect(wrap(jon2.favouriteBook).isInitialized()).toBe(false);

    await wrap(jon2.favouriteBook).init();
    expect(jon2.favouriteBook!.constructor.name).toBe('Book4');
    expect(wrap(jon2.favouriteBook).isInitialized()).toBe(true);
    expect(jon2.favouriteBook!.title).toBe('Bible');
  });

  test('many to many relation', async () => {
    const author = orm.em.create(Author4, { name: 'Jon Snow', email: 'snow@wall.st' });
    const book1 = orm.em.create(Book4, { title: 'My Life on the Wall, part 1', author });
    const book2 = orm.em.create(Book4, { title: 'My Life on the Wall, part 2', author });
    const book3 = orm.em.create(Book4, { title: 'My Life on the Wall, part 3', author });
    const tag1 = orm.em.create(BookTag4, { name: 'silly' });
    const tag2 = orm.em.create(BookTag4, { name: 'funny' });
    const tag3 = orm.em.create(BookTag4, { name: 'sick' });
    const tag4 = orm.em.create(BookTag4, { name: 'strange' });
    const tag5 = orm.em.create(BookTag4, { name: 'sexy' });
    book1.tags.add(tag1, tag3);
    book2.tags.add(tag1, tag2, tag5);
    book3.tags.add(tag2, tag4, tag5);

    await orm.em.persist(book1);
    await orm.em.persist(book2);
    await orm.em.persist(book3).flush();

    expect(tag1.id).toBeDefined();
    expect(tag2.id).toBeDefined();
    expect(tag3.id).toBeDefined();
    expect(tag4.id).toBeDefined();
    expect(tag5.id).toBeDefined();

    // test inverse side
    const tagRepository = orm.em.getRepository(BookTag4);
    let tags = await tagRepository.findAll();
    expect(tags).toBeInstanceOf(Array);
    expect(tags.length).toBe(5);
    expect(tags[0].constructor.name).toBe('BookTag4');
    expect(tags[0].name).toBe('silly');
    expect(tags[0].books).toBeInstanceOf(Collection);
    expect(tags[0].books.isInitialized()).toBe(true);
    expect(tags[0].books.isDirty()).toBe(false);
    expect(tags[0].books.count()).toBe(2);
    expect(tags[0].books.length).toBe(2);

    orm.em.clear();
    tags = await orm.em.find(BookTag4, {});
    expect(tags[0].books.isInitialized()).toBe(false);
    expect(tags[0].books.isDirty()).toBe(false);
    expect(() => tags[0].books.getItems()).toThrowError(/Collection<Book4> of entity BookTag4\[\d+] not initialized/);
    expect(() => tags[0].books.remove(book1, book2)).toThrowError(/Collection<Book4> of entity BookTag4\[\d+] not initialized/);
    expect(() => tags[0].books.removeAll()).toThrowError(/Collection<Book4> of entity BookTag4\[\d+] not initialized/);
    expect(() => tags[0].books.contains(book1)).toThrowError(/Collection<Book4> of entity BookTag4\[\d+] not initialized/);

    // test M:N lazy load
    orm.em.clear();
    tags = await tagRepository.findAll();
    await tags[0].books.init();
    expect(tags[0].books.count()).toBe(2);
    expect(tags[0].books.getItems()[0].constructor.name).toBe('Book4');
    expect(tags[0].books.getItems()[0].id).toBeDefined();
    expect(wrap(tags[0].books.getItems()[0]).isInitialized()).toBe(true);
    expect(tags[0].books.isInitialized()).toBe(true);
    const old = tags[0];
    expect(tags[1].books.isInitialized()).toBe(false);
    tags = await tagRepository.findAll(['books']);
    expect(tags[1].books.isInitialized()).toBe(true);
    expect(tags[0].id).toBe(old.id);
    expect(tags[0]).toBe(old);
    expect(tags[0].books).toBe(old.books);

    // test M:N lazy load
    orm.em.clear();
    let book = (await orm.em.findOne(Book4, { tags: tag1.id }))!;
    expect(book.tags.isInitialized()).toBe(false);
    await book.tags.init();
    expect(book.tags.isInitialized()).toBe(true);
    expect(book.tags.count()).toBe(2);
    expect(book.tags.getItems()[0].constructor.name).toBe('BookTag4');
    expect(book.tags.getItems()[0].id).toBeDefined();
    expect(wrap(book.tags.getItems()[0]).isInitialized()).toBe(true);

    // test collection CRUD
    // remove
    expect(book.tags.count()).toBe(2);
    book.tags.remove(tagRepository.getReference(tag1.id));
    await orm.em.persist(book).flush();
    orm.em.clear();
    book = (await orm.em.findOne(Book4, book.id, ['tags']))!;
    expect(book.tags.count()).toBe(1);

    // add
    book.tags.add(tagRepository.getReference(tag1.id)); // we need to get reference as tag1 is detached from current EM
    await orm.em.persist(book).flush();
    orm.em.clear();
    book = (await orm.em.findOne(Book4, book.id, ['tags']))!;
    expect(book.tags.count()).toBe(2);

    // contains
    expect(book.tags.contains(tagRepository.getReference(tag1.id))).toBe(true);
    expect(book.tags.contains(tagRepository.getReference(tag2.id))).toBe(false);
    expect(book.tags.contains(tagRepository.getReference(tag3.id))).toBe(true);
    expect(book.tags.contains(tagRepository.getReference(tag4.id))).toBe(false);
    expect(book.tags.contains(tagRepository.getReference(tag5.id))).toBe(false);

    // removeAll
    book.tags.removeAll();
    await orm.em.persist(book).flush();
    orm.em.clear();
    book = (await orm.em.findOne(Book4, book.id, ['tags']))!;
    expect(book.tags.count()).toBe(0);
  });

  test('populating many to many relation', async () => {
    const p1 = orm.em.create(Publisher4, { name: 'foo' });
    expect(p1.tests).toBeInstanceOf(Collection);
    expect(p1.tests.isInitialized()).toBe(true);
    expect(p1.tests.isDirty()).toBe(false);
    expect(p1.tests.count()).toBe(0);
    const p2 = orm.em.create(Publisher4, { name: 'bar' });
    p2.tests.add(orm.em.create(Test4, {}), orm.em.create(Test4, {}));
    await orm.em.persist([p1, p2]).flush();
    const repo = orm.em.getRepository(Publisher4);

    orm.em.clear();
    const publishers = await repo.findAll(['tests']);
    expect(publishers).toBeInstanceOf(Array);
    expect(publishers.length).toBe(2);
    expect(publishers[0].constructor.name).toBe('Publisher4');
    expect(publishers[0].tests).toBeInstanceOf(Collection);
    expect(publishers[0].tests.isInitialized()).toBe(true);
    expect(publishers[0].tests.isDirty()).toBe(false);
    expect(publishers[0].tests.count()).toBe(0);
    await publishers[0].tests.init(); // empty many to many on owning side should not make db calls
    expect(wrap(publishers[1].tests.getItems()[0]).isInitialized()).toBe(true);
  });

  test('populating many to many relation on inverse side', async () => {
    const author = orm.em.create(Author4, { name: 'Jon Snow', email: 'snow@wall.st' });
    const book1 = orm.em.create(Book4, { title: 'My Life on } The Wall, part 1', author });
    const book2 = orm.em.create(Book4, { title: 'My Life on } The Wall, part 2', author });
    const book3 = orm.em.create(Book4, { title: 'My Life on } The Wall, part 3', author });
    const tag1 = orm.em.create(BookTag4, { name: 'silly' });
    const tag2 = orm.em.create(BookTag4, { name: 'funny' });
    const tag3 = orm.em.create(BookTag4, { name: 'sick' });
    const tag4 = orm.em.create(BookTag4, { name: 'strange' });
    const tag5 = orm.em.create(BookTag4, { name: 'sexy' });
    book1.tags.add(tag1, tag3);
    book2.tags.add(tag1, tag2, tag5);
    book3.tags.add(tag2, tag4, tag5);
    await orm.em.persist([book1, book2, book3]).flush();
    const repo = orm.em.getRepository(BookTag4);

    orm.em.clear();
    const tags = await repo.findAll(['books']);
    expect(tags).toBeInstanceOf(Array);
    expect(tags.length).toBe(5);
    expect(tags[0].constructor.name).toBe('BookTag4');
    expect(tags[0].books).toBeInstanceOf(Collection);
    expect(tags[0].books.isInitialized()).toBe(true);
    expect(tags[0].books.isDirty()).toBe(false);
    expect(tags[0].books.count()).toBe(2);
    expect(wrap(tags[0].books.getItems()[0]).isInitialized()).toBe(true);
  });

  test('trying to populate non-existing or non-reference property will throw', async () => {
    const repo = orm.em.getRepository(Author4);
    const author = orm.em.create(Author4, { name: 'Johny Cash', email: 'johny@cash.com' });
    await repo.persistAndFlush(author);
    orm.em.clear();

    await expect(repo.findAll(['tests'])).rejects.toThrowError(`Entity 'Author4' does not have property 'tests'`);
    await expect(repo.findOne(author.id, ['tests'])).rejects.toThrowError(`Entity 'Author4' does not have property 'tests'`);
  });

  test('many to many collection does have fixed order', async () => {
    const repo = orm.em.getRepository(Publisher4);
    const publisher = orm.em.create(Publisher4, {});
    const t1 = orm.em.create(Test4, { name: 't1' });
    const t2 = orm.em.create(Test4, { name: 't2' });
    const t3 = orm.em.create(Test4, { name: 't3' });
    await orm.em.persist([t1, t2, t3]).flush();
    publisher.tests.add(t2, t1, t3);
    await repo.persistAndFlush(publisher);
    orm.em.clear();

    const ent = (await repo.findOne(publisher.id, ['tests']))!;
    await expect(ent.tests.count()).toBe(3);
    await expect(ent.tests.getIdentifiers()).toEqual([t2.id, t1.id, t3.id]);

    await ent.tests.init();
    await expect(ent.tests.getIdentifiers()).toEqual([t2.id, t1.id, t3.id]);
  });

  test('property onUpdate hook (updatedAt field)', async () => {
    const repo = orm.em.getRepository(Author4);
    const author = orm.em.create(Author4, { name: 'name', email: 'email' });
    await repo.persistAndFlush(author);
    expect(author.createdAt).toBeDefined();
    expect(author.updatedAt).toBeDefined();
    // allow 1 ms difference as updated time is recalculated when persisting
    expect(+author.updatedAt - +author.createdAt).toBeLessThanOrEqual(1);

    author.name = 'name1';
    await new Promise(resolve => setTimeout(resolve, 10));
    await repo.persistAndFlush(author);
    await expect(author.createdAt).toBeDefined();
    await expect(author.updatedAt).toBeDefined();
    await expect(author.updatedAt).not.toEqual(author.createdAt);
    await expect(author.updatedAt > author.createdAt).toBe(true);

    orm.em.clear();
    const ent = (await repo.findOne(author.id))!;
    await expect(ent.createdAt).toBeDefined();
    await expect(ent.updatedAt).toBeDefined();
    await expect(ent.updatedAt).not.toEqual(ent.createdAt);
    await expect(ent.updatedAt > ent.createdAt).toBe(true);
  });

  test('EM supports native insert/update/delete', async () => {
    orm.config.getLogger().setDebugMode(false);
    const res1 = await orm.em.nativeInsert('Author4', { name: 'native name 1', email: 'native1@email.com' });
    expect(typeof res1).toBe('number');

    const res2 = await orm.em.nativeUpdate('Author4', { name: 'native name 1' }, { name: 'new native name' });
    expect(res2).toBe(1);

    const res3 = await orm.em.nativeDelete('Author4', { name: 'new native name' });
    expect(res3).toBe(1);

    const res4 = await orm.em.nativeInsert('Author4', { createdAt: new Date('1989-11-17'), updatedAt: new Date('2018-10-28'), name: 'native name 2', email: 'native2@email.com' });
    expect(typeof res4).toBe('number');

    const res5 = await orm.em.nativeUpdate('Author4', { name: 'native name 2' }, { name: 'new native name', updatedAt: new Date('2018-10-28') });
    expect(res5).toBe(1);
  });

  test('EM supports smart search conditions', async () => {
    const author = orm.em.create(Author4, { name: 'name', email: 'email' });
    const b1 = orm.em.create(Book4, { title: 'b1', author });
    const b2 = orm.em.create(Book4, { title: 'b2', author });
    const b3 = orm.em.create(Book4, { title: 'b3', author });
    await orm.em.persist([b1, b2, b3]).flush();
    orm.em.clear();

    const a1 = (await orm.em.findOne(Author4, { 'id:ne': 10 } as any))!;
    expect(a1).not.toBeNull();
    expect(a1.id).toBe(author.id);
    const a2 = (await orm.em.findOne(Author4, { 'id>=': 1 } as any))!;
    expect(a2).not.toBeNull();
    expect(a2.id).toBe(author.id);
    const a3 = (await orm.em.findOne(Author4, { 'id:nin': [2, 3, 4] } as any))!;
    expect(a3).not.toBeNull();
    expect(a3.id).toBe(author.id);
    const a4 = (await orm.em.findOne(Author4, { 'id:in': [] } as any))!;
    expect(a4).toBeNull();
    const a5 = (await orm.em.findOne(Author4, { 'id:nin': [] } as any))!;
    expect(a5).not.toBeNull();
    expect(a5.id).toBe(author.id);
  });

  test('datetime is stored in correct timezone', async () => {
    const author = orm.em.create(Author4, { name: 'n', email: 'e' });
    author.createdAt = new Date('2000-01-01T00:00:00Z');
    await orm.em.persistAndFlush(author);
    orm.em.clear();

    const res = await orm.em.getConnection().execute<{ created_at: number }[]>(`select created_at as created_at from author4 where id = ${author.id}`);
    expect(res[0].created_at).toBe(+author.createdAt);
    const a = await orm.em.findOneOrFail(Author4, author.id);
    expect(+a.createdAt!).toBe(+author.createdAt);
  });

  test('merging results from QB to existing entity', async () => {
    const bar = orm.em.create(FooBar4, { name: 'b1' });
    await orm.em.persistAndFlush(bar);
    orm.em.clear();

    const b1 = await orm.em.findOneOrFail(FooBar4, { name: 'b1' });
    expect(b1.virtual).toBeUndefined();

    await orm.em.createQueryBuilder(FooBar4).select(`id, '123' as virtual`).getResultList();
    expect(b1.virtual).toBe('123');
  });

  test('custom types', async () => {
    const bar = orm.em.create(FooBar4, { name: 'b1 \'the bad\' lol' });
    bar.blob = Buffer.from([1, 2, 3, 4, 5]);
    bar.array = [1, 2, 3, 4, 5];
    bar.object = { foo: 'bar "lol" \'wut\' escaped', bar: 3 };
    await orm.em.persistAndFlush(bar);
    orm.em.clear();

    const b1 = await orm.em.findOneOrFail(FooBar4, bar.id);
    expect(b1.blob).toEqual(Buffer.from([1, 2, 3, 4, 5]));
    expect(b1.blob).toBeInstanceOf(Buffer);
    expect(b1.array).toEqual([1, 2, 3, 4, 5]);
    expect(b1.array![2]).toBe(3);
    expect(b1.array).toBeInstanceOf(Array);
    expect(b1.object).toEqual({ foo: 'bar "lol" \'wut\' escaped', bar: 3 });
    expect(b1.object).toBeInstanceOf(Object);
    expect(b1.object!.bar).toBe(3);

    b1.object = 'foo';
    await orm.em.flush();
    orm.em.clear();

    const b2 = await orm.em.findOneOrFail(FooBar4, bar.id);
    expect(b2.object).toBe('foo');

    b2.object = [1, 2, '3'];
    await orm.em.flush();
    orm.em.clear();

    const b3 = await orm.em.findOneOrFail(FooBar4, bar.id);
    expect(b3.object[0]).toBe(1);
    expect(b3.object[1]).toBe(2);
    expect(b3.object[2]).toBe('3');

    b3.object = 123;
    await orm.em.flush();
    orm.em.clear();

    const b4 = await orm.em.findOneOrFail(FooBar4, bar.id);
    expect(b4.object).toBe(123);
  });

  test('question marks and parameter interpolation (GH issue #920)', async () => {
    const e = orm.em.create(Author4, { name: `?baz? uh \\? ? wut? \\\\ wut`, email: '123' });
    await orm.em.persistAndFlush(e);
    const e2 = await orm.em.fork().findOneOrFail(Author4, e);
    expect(e2.name).toBe(`?baz? uh \\? ? wut? \\\\ wut`);
    const res = await orm.em.getKnex().raw('select ? as count', [1]);
    expect(res[0].count).toBe(1);
  });

  // this should run in ~600ms (when running single test locally)
  test('perf: one to many', async () => {
    const author = orm.em.create(Author4, { name: 'n', email: 'e' });
    await orm.em.persistAndFlush(author);

    for (let i = 1; i <= 3_000; i++) {
      const book = orm.em.create(Book4, { title: 'My Life on The Wall, part ' + i, author });
      author.books.add(book);
    }

    await orm.em.flush();
    expect(author.books.getItems().every(b => b.id)).toBe(true);
  });

  // this should run in ~400ms (when running single test locally)
  test('perf: batch insert and update', async () => {
    const authors = new Set<IAuthor4>();

    for (let i = 1; i <= 1000; i++) {
      const author = orm.em.create(Author4, { name: `Jon Snow ${i}`, email: `snow-${i}@wall.st` });
      orm.em.persist(author);
      authors.add(author);
    }

    await orm.em.flush();
    authors.forEach(author => expect(author.id).toBeGreaterThan(0));

    authors.forEach(a => a.termsAccepted = true);
    await orm.em.flush();
  });

  afterAll(async () => {
    await orm.close(true);
  });

});
