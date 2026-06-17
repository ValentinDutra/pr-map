import { Highlight, themes } from 'prism-react-renderer';

function lineBackground(text: string): string {
  if (text.startsWith('+') && !text.startsWith('+++')) return 'bg-green-50';
  if (text.startsWith('-') && !text.startsWith('---')) return 'bg-red-50';
  if (text.startsWith('@@')) return 'bg-blue-50';
  return '';
}

export function DiffView({ patch }: { patch: string }) {
  return (
    <Highlight code={patch} language="diff" theme={themes.github}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className="overflow-auto rounded border border-slate-200 p-2 font-mono text-[11px] leading-4">
          {tokens.map((line, lineIndex) => {
            const text = line.map((token) => token.content).join('');
            const lineProps = getLineProps({ line });
            return (
              <div
                key={lineIndex}
                {...lineProps}
                className={`${lineProps.className ?? ''} ${lineBackground(text)}`}
              >
                {line.map((token, tokenIndex) => (
                  <span key={tokenIndex} {...getTokenProps({ token })} />
                ))}
              </div>
            );
          })}
        </pre>
      )}
    </Highlight>
  );
}
