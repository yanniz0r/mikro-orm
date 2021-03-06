import { unlinkSync } from 'fs';
import { BASE_DIR } from '../bootstrap';
import { Entity, ManyToOne, OneToOne, PrimaryKey, Property } from '../../lib/decorators';
import { MikroORM, ReflectMetadataProvider } from '../../lib';
import { SqliteDriver } from '../../lib/drivers/SqliteDriver';

@Entity()
export class Rate {

  @PrimaryKey()
  id!: number;

  @Property()
  name: string;

  @OneToOne('Application', 'rate1')
  application1?: any;

  @OneToOne('Application', 'rate3')
  application3?: any;

  constructor(name: string) {
    this.name = name;
  }

}

@Entity()
export class Application {

  @PrimaryKey()
  id!: number;

  @OneToOne({ fieldName: 'application_rate1_id' })
  rate1!: Rate;

  @ManyToOne({ fieldName: 'application_rate2_id' })
  rate2!: Rate;

  @OneToOne({ joinColumn: 'application_rate3_id' })
  rate3!: Rate;

  @ManyToOne({ joinColumn: 'application_rate4_id' })
  rate4!: Rate;

}

describe('GH issue 557', () => {

  let orm: MikroORM<SqliteDriver>;

  beforeAll(async () => {
    orm = await MikroORM.init({
      entities: [Application, Rate],
      dbName: BASE_DIR + '/../temp/mikro_orm_test_gh557.db',
      type: 'sqlite',
      metadataProvider: ReflectMetadataProvider,
      cache: { enabled: false },
    });
    await orm.getSchemaGenerator().dropSchema();
    await orm.getSchemaGenerator().createSchema();
  });

  afterAll(async () => {
    await orm.close(true);
    unlinkSync(orm.config.get('dbName')!);
  });

  test('GH issue 557', async () => {
    const a = new Application();
    a.rate1 = new Rate('r1');
    a.rate2 = new Rate('r2');
    a.rate3 = new Rate('r3');
    a.rate4 = new Rate('r4');
    await orm.em.persistAndFlush(a);
    orm.em.clear();

    const res = await orm.em.findOneOrFail(Application, a, ['rate1', 'rate2', 'rate3', 'rate4']);
    expect(res.rate1.name).toBe('r1');
    expect(res.rate2.name).toBe('r2');
    expect(res.rate3.name).toBe('r3');
    expect(res.rate4.name).toBe('r4');
  });

});
