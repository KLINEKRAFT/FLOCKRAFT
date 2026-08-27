'use client';

/**
 * Last-resort boundary: catches failures in the root layout itself, where the
 * normal error boundary has no shell to render into. Styles are inline because
 * the stylesheet may be exactly what failed.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#07090a',
          color: '#e8eaec',
          fontFamily: 'ui-monospace, monospace',
          textAlign: 'center',
          padding: '2rem',
        }}
      >
        <div>
          <p style={{ letterSpacing: '0.34em', fontSize: 13, marginBottom: 24 }}>FLOCKRAFT</p>
          <p style={{ fontSize: 11, letterSpacing: '0.16em', color: '#e0736a', marginBottom: 8 }}>
            CRITICAL FAULT
          </p>
          <p style={{ fontSize: 13, color: '#9aa4ad', marginBottom: 24 }}>
            The application shell failed to start.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 44,
              padding: '0 20px',
              background: 'rgba(126,224,138,0.15)',
              border: '1px solid rgba(126,224,138,0.45)',
              color: '#7ee08a',
              borderRadius: 3,
              fontFamily: 'inherit',
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Restart
          </button>
        </div>
      </body>
    </html>
  );
}
