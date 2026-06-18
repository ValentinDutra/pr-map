import { describe, it, expect } from 'vitest';
import { findRule } from './import-rules.js';

describe('javascript/typescript import resolution', () => {
  const repoFiles = new Set(['src/result.ts', 'src/index.js', 'lib/util/index.tsx']);
  const rule = findRule('src/retry.ts');

  it('resolves a NodeNext ".js" specifier to the corresponding ".ts" file', () => {
    expect(rule?.resolve('./result.js', 'src/retry.ts', repoFiles)).toContain('src/result.ts');
  });

  it('resolves a plain ".js" specifier to a real ".js" file', () => {
    expect(rule?.resolve('./index.js', 'src/app.js', repoFiles)).toContain('src/index.js');
  });

  it('resolves a directory import to its index file', () => {
    expect(rule?.resolve('../lib/util', 'src/app.ts', repoFiles)).toContain(
      'lib/util/index.tsx',
    );
  });

  it('ignores bare (external) specifiers', () => {
    expect(rule?.resolve('express', 'src/app.ts', repoFiles)).toEqual([]);
  });

  it('strips a bundler query suffix before resolving', () => {
    expect(rule?.resolve('./result.js?worker', 'src/retry.ts', repoFiles)).toContain(
      'src/result.ts',
    );
  });
});

describe('go import resolution', () => {
  const repoFiles = new Set([
    'example.com/app/internal/store/store.go',
    'example.com/app/internal/store/query.go',
    'example.com/app/cmd/main.go',
  ]);
  const rule = findRule('example.com/app/cmd/main.go');

  it('extracts single and grouped imports including aliases', () => {
    const content = [
      'import "example.com/app/internal/store"',
      'import (',
      '  "fmt"',
      '  alias "example.com/app/cmd"',
      ')',
    ].join('\n');
    expect(rule?.extractSpecifiers(content)).toEqual([
      'fmt',
      'example.com/app/cmd',
      'example.com/app/internal/store',
    ]);
  });

  it('resolves a package import to all .go files under the matching directory', () => {
    const targets = rule?.resolve(
      'app/internal/store',
      'example.com/app/cmd/main.go',
      repoFiles,
    );
    expect(targets).toContain('example.com/app/internal/store/store.go');
    expect(targets).toContain('example.com/app/internal/store/query.go');
  });

  it('returns no targets for an unknown package', () => {
    expect(rule?.resolve('third/party/pkg', 'example.com/app/cmd/main.go', repoFiles)).toEqual(
      [],
    );
  });
});

describe('java/kotlin import resolution', () => {
  const repoFiles = new Set([
    'src/main/java/com/example/User.java',
    'src/main/kotlin/com/example/model/Order.kt',
    'src/main/kotlin/com/example/model/Item.kt',
  ]);

  it('extracts imports and ignores static imports', () => {
    const rule = findRule('src/main/java/com/example/App.java');
    const content = [
      'import com.example.User;',
      'import static com.example.Util.helper;',
      'import com.example.model.*;',
    ].join('\n');
    expect(rule?.extractSpecifiers(content)).toEqual([
      'com.example.User',
      'com.example.model.*',
    ]);
  });

  it('resolves a class import to the matching .java file', () => {
    const rule = findRule('src/main/java/com/example/App.java');
    expect(rule?.resolve('com.example.User', 'src/main/java/com/example/App.java', repoFiles)).toContain(
      'src/main/java/com/example/User.java',
    );
  });

  it('resolves a wildcard import to all files under the package directory', () => {
    const rule = findRule('src/main/kotlin/com/example/App.kt');
    const targets = rule?.resolve(
      'com.example.model.*',
      'src/main/kotlin/com/example/App.kt',
      repoFiles,
    );
    expect(targets).toContain('src/main/kotlin/com/example/model/Order.kt');
    expect(targets).toContain('src/main/kotlin/com/example/model/Item.kt');
  });
});

describe('ruby import resolution', () => {
  const repoFiles = new Set(['lib/parser.rb', 'app/models/user.rb', 'app/models/order.rb']);
  const rule = findRule('app/models/order.rb');

  it('extracts require and require_relative statements', () => {
    const content = ["require 'parser'", 'require_relative "user"'].join('\n');
    expect(rule?.extractSpecifiers(content)).toEqual([
      'require_relative:user',
      'parser',
    ]);
  });

  it('resolves require_relative against the source directory', () => {
    expect(rule?.resolve('require_relative:user', 'app/models/order.rb', repoFiles)).toEqual([
      'app/models/user.rb',
    ]);
  });

  it('resolves a plain require by matching a file ending with the name', () => {
    expect(rule?.resolve('parser', 'app/models/order.rb', repoFiles)).toContain('lib/parser.rb');
  });
});

describe('rust import resolution', () => {
  const repoFiles = new Set([
    'src/main.rs',
    'src/config.rs',
    'src/store/mod.rs',
    'src/store/query.rs',
  ]);
  const rule = findRule('src/main.rs');

  it('extracts mod declarations and crate-relative use statements', () => {
    const content = ['mod config;', 'use crate::store::query::run;'].join('\n');
    expect(rule?.extractSpecifiers(content)).toEqual([
      'mod:config',
      'crate::store::query::run',
    ]);
  });

  it('resolves a mod declaration to a sibling file', () => {
    expect(rule?.resolve('mod:config', 'src/main.rs', repoFiles)).toEqual(['src/config.rs']);
  });

  it('resolves a mod declaration to a directory mod.rs', () => {
    expect(rule?.resolve('mod:store', 'src/main.rs', repoFiles)).toEqual(['src/store/mod.rs']);
  });

  it('resolves a crate-relative use to the module file', () => {
    expect(rule?.resolve('crate::store::query::run', 'src/main.rs', repoFiles)).toContain(
      'src/store/query.rs',
    );
  });
});
