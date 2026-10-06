import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { renderMarkdown } from '../../lib/markdown';
import { EmptyState } from '../../components/ui';
import { ARTICLES, ARTICLE_MAP } from './index';

const GROUPS = [...new Set(ARTICLES.map((a) => a.group))];

/** Search articles: title and description weigh more than body text. */
function search(term: any) {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return ARTICLES.map((a) => {
    const head = `${a.title} ${a.description}`.toLowerCase();
    const body = a.text.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (head.includes(w)) score += 5;
      const n = body.split(w).length - 1;
      if (!n) return null;
      score += Math.min(n, 10);
    }
    const at = body.indexOf(words[0]);
    const snippet = a.text.slice(Math.max(0, at - 60), at + 140).replace(/[#*`|>[\]]/g, '').replace(/\(\/[^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    return { a, score, snippet };
  }).filter(Boolean).sort((x, y) => y.score - x.score);
}

export default function Help() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const ref = useRef(null);
  const article = slug ? ARTICLE_MAP[slug] : null;
  const html = useMemo(() => (article ? renderMarkdown(article.text) : ''), [article]);
  const results = useMemo(() => search(term), [term]);

  useEffect(() => { document.querySelector('.content')?.scrollTo(0, 0); }, [slug]);

  // Keep in-app links inside the single-page app.
  const onClick = (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href?.startsWith('/')) { e.preventDefault(); navigate(href); }
  };

  const idx = article ? ARTICLES.indexOf(article) : -1;
  const prev = idx > 0 ? ARTICLES[idx - 1] : null;
  const next = idx >= 0 && idx < ARTICLES.length - 1 ? ARTICLES[idx + 1] : null;

  return (
    <div className="page">
      <div className="help-layout">
        <nav className="help-nav card" aria-label="Guides" style={{ padding: '8px 6px' }}>
          <Link to="/help" className={!slug ? 'active' : ''}>Help home</Link>
          {GROUPS.map((g) => (
            <div key={g}>
              <h4>{g}</h4>
              {ARTICLES.filter((a) => a.group === g).map((a) => (
                <Link key={a.slug} to={`/help/${a.slug}`} className={a.slug === slug ? 'active' : ''}>{a.title}</Link>
              ))}
            </div>
          ))}
        </nav>
        <div>
          <input type="search" className="input help-search mb" placeholder="Search the guides, e.g. “return”, “opening stock”, “GST”" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search the guides" />
          {term.trim() ? (
            <div className="card">
              {results.length === 0 && <EmptyState title="No guides match" text="Try a simpler word, like “invoice”, “stock” or “payment”." />}
              {results.map(({ a, snippet }) => (
                <Link key={a.slug} to={`/help/${a.slug}`} onClick={() => setTerm('')} style={{ display: 'block', padding: '12px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                  <div className="bold">{a.title}</div>
                  <div className="small muted">…{snippet}…</div>
                </Link>
              ))}
            </div>
          ) : article ? (
            <div className="card"><div className="card-body" style={{ padding: '28px 32px' }}>
              {/* eslint-disable-next-line react/no-danger */}
              <article className="article" ref={ref} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
              <div className="row mt" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 28 }}>
                {prev && <Link to={`/help/${prev.slug}`}>← {prev.title}</Link>}
                <span className="spacer" />
                {next && <Link to={`/help/${next.slug}`}>{next.title} →</Link>}
              </div>
            </div></div>
          ) : slug ? (
            <EmptyState title="Guide not found" action={<Link className="btn" to="/help">Back to Help home</Link>} />
          ) : (
            <div className="article" style={{ maxWidth: 'none' }}>
              <h1>Help & Guides</h1>
              <p className="lead">Step-by-step guides written for everyone — no inventory or accounting experience needed. New here? Begin with <Link to="/help/getting-started">Start here: your first day</Link>.</p>
              {GROUPS.map((g) => (
                <div key={g}>
                  <h2>{g}</h2>
                  <div className="help-cards">
                    {ARTICLES.filter((a) => a.group === g).map((a) => (
                      <Link key={a.slug} to={`/help/${a.slug}`} className="help-card">
                        <div className="t">{a.title}</div>
                        <div className="d">{a.description}</div>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
              <blockquote><p><strong>Tip:</strong> the <strong>?</strong> button at the top of every screen opens the guide for that screen.</p></blockquote>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
