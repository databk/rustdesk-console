import { readFileSync } from 'node:fs';
import { resolveAssetPath } from '../common/utils/runtime-paths';
import { STABLE_VERSION } from './manifest';
export function readBuildInfo(): {
  version: string;
  sourceCommit: string;
  ready: boolean;
} {
  try {
    const metadata = JSON.parse(
      readFileSync(
        resolveAssetPath(
          __dirname,
          '../../release-metadata.json',
          'release-metadata.json',
        ),
        'utf8',
      ),
    ) as { version: string; sourceCommit: string };
    if (
      STABLE_VERSION.test(metadata.version) &&
      /^[a-f0-9]{40}$/.test(metadata.sourceCommit)
    )
      return {
        version: metadata.version,
        sourceCommit: metadata.sourceCommit,
        ready: true,
      };
  } catch {
    /* 旧安装不伪造运行版本证明。 */
  }
  return { version: 'unknown', sourceCommit: 'unknown', ready: false };
}
