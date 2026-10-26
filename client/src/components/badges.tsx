import type { License, ProductStatus, ProductType } from '../../../shared/types';

const STATUS: Record<ProductStatus, [string, string]> = {
  ingesting: ['Ingesting', 'run'],
  ingested: ['Ingested', 'ok'],
  writing: ['Writing', 'run'],
  written: ['Draft ready', 'ok'],
  rendering: ['Rendering', 'run'],
  rendered: ['PDF ready', 'gold'],
  failed: ['Failed', 'bad'],
};

export function StatusBadge({ status }: { status: ProductStatus }) {
  const [label, tone] = STATUS[status] ?? [status, 'neutral'];
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function TypeBadge({ type }: { type: ProductType }) {
  return <span className="badge neutral">{type}</span>;
}

export function LicenseBadge({ status }: { status: License['status'] }) {
  if (status === 'confirmed') return <span className="badge ok">Confirmed</span>;
  if (status === 'detected') return <span className="badge warn">Review terms</span>;
  return <span className="badge bad">Not confirmed</span>;
}
