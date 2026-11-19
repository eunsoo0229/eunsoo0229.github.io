// 장비 중고거래 화면 공용 조각 (카드, 상태 표시, 별점, 설정 필요 안내).
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon';
import BackButton from '../../components/BackButton';
import EmptyState from '../../components/EmptyState';
import { formatWon } from '../../lib/ecosystem/common';
import { GEAR_CATEGORIES, GEAR_CONDITIONS, GEAR_STATUS, type GearListing, type GearStatus } from '../../lib/gear/service';

export function StatusPill({ status }: { status: GearStatus }) {
  const cls = status === 'active' ? 'eco-pill--good' : status === 'reserved' ? 'eco-pill--warn' : 'eco-pill--muted';
  return <span className={`eco-pill ${cls}`}>{GEAR_STATUS[status]}</span>;
}

export function Stars({ value, label }: { value: number; label?: string }) {
  const rounded = Math.round(value);
  return (
    <span className="gear-stars" role="img" aria-label={label ?? `별점 ${value}점`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name={n <= rounded ? 'star-filled' : 'star'} />
      ))}
    </span>
  );
}

export function GearCard({ item, extra }: { item: GearListing; extra?: ReactNode }) {
  const cover = item.images[0];
  return (
    <div className="gear-card-wrap">
      <Link to={`/gear/${item.id}`} className="eco-card eco-card--link gear-card" data-testid="gear-card">
        <div className="eco-card__media eco-card__media--square">
          {cover ? <img src={cover} alt="" loading="lazy" /> : <Icon name="glove" className="gear-card__placeholder" />}
          {item.status !== 'active' && (
            <span className="gear-card__status">
              <StatusPill status={item.status} />
            </span>
          )}
        </div>
        <h3 className="gear-card__title">{item.title}</h3>
        <div className="eco-price">{item.price === 0 ? '무료 나눔' : formatWon(item.price)}</div>
        <div className="eco-row gear-card__pills">
          <span className="eco-pill eco-pill--accent">{GEAR_CONDITIONS[item.condition]?.label ?? item.condition}</span>
          <span className="eco-pill">{GEAR_CATEGORIES[item.category] ?? item.category}</span>
          {item.size && <span className="eco-pill">{item.size}</span>}
        </div>
        <div className="eco-row eco-row--between gear-card__foot">
          <span className="eco-meta gear-ellipsis">
            {item.region ? (
              <>
                <Icon name="pin" /> {item.region}
              </>
            ) : (
              '지역 미기재'
            )}
          </span>
          <span className="eco-meta">
            <Icon name="heart" /> {item.favoriteCount}
          </span>
        </div>
        <div className="eco-row">
          {item.meetupAvailable && <span className="eco-pill">직거래</span>}
          {item.shippingAvailable && <span className="eco-pill">택배</span>}
          {item.moderation === 'removed' && <span className="eco-pill eco-pill--warn">운영 정책으로 내려짐</span>}
        </div>
      </Link>
      {extra}
    </div>
  );
}

export function NotConfigured({ fallback = '/' }: { fallback?: string }) {
  return (
    <div className="page">
      <div className="container">
        <BackButton fallback={fallback} />
        <EmptyState icon="🛒" text="장비 중고거래는 Supabase(클라우드) 설정이 필요합니다. 앱 관리자에게 설정을 요청해 주세요." />
      </div>
    </div>
  );
}

export function LoginLink({ text }: { text: string }) {
  return (
    <p className="eco-meta">
      {text} <Link to="/login">로그인</Link>
    </p>
  );
}
