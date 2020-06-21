import { CommandModule } from 'yargs';
import chalk from 'chalk';

import { CLIHelper } from '../CLIHelper';
import { ConfigurationLoader, Utils } from '@mikro-orm/core';

export class DebugCommand implements CommandModule {

  command = 'debug';
  describe = 'Debug CLI configuration';

  /**
   * @inheritdoc
   */
  async handler() {
    CLIHelper.dump(`Current ${chalk.cyan('MikroORM')} CLI configuration`);
    await CLIHelper.dumpDependencies();
    const settings = await ConfigurationLoader.getSettings();

    if (settings.useTsNode) {
      CLIHelper.dump(' - ts-node ' + chalk.green('enabled'));
    }

    const configPaths = await CLIHelper.getConfigPaths();
    CLIHelper.dump(' - searched config paths:');
    await DebugCommand.checkPaths(configPaths, 'yellow');

    try {
      const config = await CLIHelper.getConfiguration();
      CLIHelper.dump(` - configuration ${chalk.green('found')}`);
      const length = config.get('entities', []).length;

      if (length > 0) {
        CLIHelper.dump(` - will use \`entities\` array (contains ${length} items)`);
      }
    } catch (e) {
      CLIHelper.dump(`- configuration ${chalk.red('not found')} ${chalk.red(`(${e.message})`)}`);
    }
  }

  private static async checkPaths(paths: string[], failedColor: 'red' | 'yellow', baseDir?: string, onlyDirectories = false): Promise<void> {
    for (let path of paths) {
      path = Utils.absolutePath(path, baseDir);
      path = Utils.normalizePath(path);
      const found = await Utils.pathExists(path, { onlyDirectories });

      if (found) {
        CLIHelper.dump(`   - ${path} (${chalk.green('found')})`);
      } else {
        CLIHelper.dump(`   - ${path} (${chalk[failedColor]('not found')})`);
      }
    }
  }

}
