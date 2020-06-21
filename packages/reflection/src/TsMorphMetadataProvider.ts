import { Project, PropertyDeclaration, SourceFile } from 'ts-morph';
import { EntityMetadata, EntityProperty, MetadataProvider, MetadataStorage, Utils } from '@mikro-orm/core';

export class TsMorphMetadataProvider extends MetadataProvider {

  private readonly project = new Project();
  private sources!: SourceFile[];

  useCache(): boolean {
    return this.config.get('cache').enabled ?? true;
  }

  async loadEntityMetadata(meta: EntityMetadata, name: string): Promise<void> {
    if (!meta.path) {
      return;
    }

    await this.initProperties(meta);
  }

  async getExistingSourceFile(meta: EntityMetadata, ext?: string, validate = true): Promise<SourceFile> {
    if (!ext) {
      return await this.getExistingSourceFile(meta, '.d.ts', false) || await this.getExistingSourceFile(meta, '.ts');
    }

    const path = meta.path.match(/\/[^/]+$/)![0].replace(/\.js$/, ext);

    return (await this.getSourceFile(path, validate))!;
  }

  protected async initProperties(meta: EntityMetadata): Promise<void> {
    // load types and column names
    for (const prop of Object.values(meta.properties)) {
      const type = this.extractType(prop);

      if (!type || this.config.get('discovery').alwaysAnalyseProperties) {
        await this.initPropertyType(meta, prop);
      }

      prop.type = type || prop.type;
    }
  }

  private extractType(prop: EntityProperty): string {
    if (Utils.isString(prop.entity)) {
      return prop.entity;
    }

    if (prop.entity) {
      return Utils.className(prop.entity());
    }

    return prop.type;
  }

  private async initPropertyType(meta: EntityMetadata, prop: EntityProperty): Promise<void> {
    const { type, optional } = await this.readTypeFromSource(meta, prop);
    prop.type = type;

    if (optional) {
      prop.nullable = true;
    }

    this.processWrapper(prop, 'IdentifiedReference');
    this.processWrapper(prop, 'Collection');
  }

  private async readTypeFromSource(meta: EntityMetadata, prop: EntityProperty): Promise<{ type: string; optional?: boolean }> {
    const source = await this.getExistingSourceFile(meta);
    const cls = source.getClass(meta.className);

    /* istanbul ignore next */
    if (!cls) {
      throw new Error(`Source class for entity ${meta.className} not found. If you are using webpack, see https://bit.ly/35pPDNn`);
    }

    const properties = cls.getInstanceProperties();
    const property = properties.find(v => v.getName() === prop.name) as PropertyDeclaration;

    if (!property) {
      return { type: prop.type, optional: prop.nullable };
    }

    const type = property.getType().getText(property);
    /* istanbul ignore next */
    const optional = property.hasQuestionToken?.();

    return { type, optional };
  }

  private async getSourceFile(file: string, validate: boolean): Promise<SourceFile | undefined> {
    if (!this.sources) {
      await this.initSourceFiles();
    }

    const source = this.sources.find(s => s.getFilePath().endsWith(file));

    if (!source && validate) {
      throw new Error(`Source file for entity ${file} not found, check your 'entitiesTs' option. If you are using webpack, see https://bit.ly/35pPDNn`);
    }

    return source;
  }

  private processWrapper(prop: EntityProperty, wrapper: string): void {
    const m = prop.type.match(new RegExp(`^${wrapper}<(\\w+),?.*>$`));

    if (!m) {
      return;
    }

    prop.type = m[1];

    if (wrapper === 'IdentifiedReference') {
      prop.wrappedReference = true;
    }
  }

  private async initSourceFiles(): Promise<void> {
    // All entity files are first required during the discovery, before we reach here, so it is safe to get the parts from the global
    // metadata storage. We know the path thanks the the decorators being executed. In case we are running via ts-node, the extension
    // will be already `.ts`, so no change needed. `.js` files will get renamed to `.d.ts` files as they will be used as a source for
    // the ts-morph reflection.
    const paths = Object.values(MetadataStorage.getMetadata()).map(m => m.path.replace(/\.js$/, '.d.ts'));
    this.sources = this.project.addSourceFilesAtPaths(paths);
  }

}
