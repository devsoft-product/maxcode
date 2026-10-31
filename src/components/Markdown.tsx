import { memo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'
import { cn } from '../lib/utils'

function extractLanguage(children: ReactNode): string {
  const first = Array.isArray(children) ? children[0] : children
  if (first && typeof first === 'object' && 'props' in first) {
    const props = (first as { props?: { className?: string } }).props
    const match = /language-([\w-]+)/.exec(props?.className ?? '')
    if (match) return match[1]
  }
  return ''
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const language = extractLanguage(children) || 'text'

  const copy = async () => {
    const text = preRef.current?.innerText ?? ''
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access can be blocked; leave the button unchanged.
    }
  }

  return (
    <div className="code-shell group/code">
      <div className="code-head">
        <span className="code-lang">{language}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] font-medium text-faint transition-colors hover:bg-panel hover:text-ink"
          aria-label="Copy code"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre ref={preRef} className="code-pre thin-scroll">
        {children}
      </pre>
    </div>
  )
}

function MarkdownImpl({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div className={cn('md', streaming && 'is-streaming')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export const Markdown = memo(MarkdownImpl)
