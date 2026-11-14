import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The simulation must give the same bits in every JavaScript engine, and the
// built-in transcendental functions (and **, which is Math.pow) do not.
const SHARED = fileURLToPath(new URL('..', import.meta.url));
const BANNED = /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot)\b/g;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !/^dmath\w*\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** Comments blanked out (line breaks kept, so line numbers still match). */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, (_c, pre: string) => pre);
}

describe('deterministic maths', () => {
  it('src/shared uses DMath instead of the built-in transcendental functions and **', () => {
    const problems: string[] = [];
    for (const file of sources(SHARED)) {
      const lines = code(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        const where = `src/shared/${relative(SHARED, file)}:${i + 1}`;
        for (const m of line.matchAll(BANNED)) {
          const fn = m[1];
          const fix = fn === 'hypot' ? 'DMath.hypot(x, y) (or Math.sqrt(x * x + y * y))'
            : fn === 'pow' ? 'x * x for squares, Math.sqrt for roots, or add pow to DMath'
            : `DMath.${fn}`;
          problems.push(`${where}: Math.${fn} gives different last bits in different browsers; use ${fix} from src/shared/math/dmath.ts`);
        }
        if (/\*\*/.test(line)) problems.push(`${where}: ** is Math.pow and not exact in every browser; use x * x (or DMath.sq(x)), Math.sqrt, or DMath`);
      });
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
