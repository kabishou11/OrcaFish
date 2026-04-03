import type { ReactNode } from 'react'

export interface WorkflowGuideStep {
  label: string
  title: string
  description: string
  status?: 'pending' | 'active' | 'done'
}

interface WorkflowGuideProps {
  eyebrow?: string
  title: string
  description: string
  steps: WorkflowGuideStep[]
  actions?: ReactNode
}

const STATUS_STYLES: Record<NonNullable<WorkflowGuideStep['status']>, { color: string; bg: string; border: string; dot: string }> = {
  pending: {
    color: 'var(--text-muted)',
    bg: 'rgba(148, 163, 184, 0.06)',
    border: 'rgba(148, 163, 184, 0.2)',
    dot: 'var(--text-muted)',
  },
  active: {
    color: 'var(--accent)',
    bg: 'rgba(37,99,235,0.07)',
    border: 'rgba(37,99,235,0.24)',
    dot: 'var(--accent)',
  },
  done: {
    color: 'var(--low)',
    bg: 'rgba(22,163,74,0.08)',
    border: 'rgba(22,163,74,0.24)',
    dot: 'var(--low)',
  },
}

export default function WorkflowGuide({ eyebrow, title, description, steps, actions }: WorkflowGuideProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 'var(--sp-4)',
        padding: 'var(--sp-5)',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        background: 'linear-gradient(135deg, rgba(37,99,235,0.04), rgba(255,255,255,0.96))',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {eyebrow && (
          <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}>
            {eyebrow}
          </div>
        )}
        <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>{description}</div>
        {actions && <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'auto' }}>{actions}</div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-3)' }}>
        {steps.map((step, index) => {
          const status = step.status ?? 'pending'
          const style = STATUS_STYLES[status]
          return (
            <div
              key={`${step.label}-${index}`}
              style={{
                padding: 'var(--sp-4)',
                borderRadius: 'var(--radius-sm)',
                background: style.bg,
                border: `1px solid ${style.border}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--sp-2)',
                minHeight: 138,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                <span style={{ fontSize: '0.68rem', color: style.color, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>
                  {step.label}
                </span>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: style.dot,
                    boxShadow: status === 'active' ? `0 0 10px ${style.dot}` : 'none',
                    flexShrink: 0,
                  }}
                />
              </div>
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.4 }}>{step.title}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{step.description}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
