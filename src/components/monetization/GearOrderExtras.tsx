import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { formatWon } from '../../lib/ecosystem/common';
import { GEAR_DISPUTE_LABEL, listDisputesForOrders, openGearDispute, type GearDispute, type GearDisputeReason } from '../../lib/monetization/service';

const DISPUTE_STATUS: Record<GearDispute['status'], string> = { open: '운영자 검토 중', resolved_refund: '환불 판정', resolved_no_refund: '환불 없음으로 종결', withdrawn: '철회' };

/** 기존 장비 주문 카드에 붙는 수익화 확장: 판매자에게 수수료·정산 예정액, 거래 당사자에게 분쟁 신고. */
export default function GearOrderExtras({ orderId, status, role }: { orderId: string; status: string; role: 'buyer' | 'seller' }) {
  const [fee, setFee] = useState<{ fee_bp: number | null; platform_fee_krw: number | null; seller_net_krw: number | null } | null>(null);
  const [dispute, setDispute] = useState<GearDispute | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<GearDisputeReason>('not_received');
  const [detail, setDetail] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    if (role === 'seller') void supabase.from('gear_orders').select('fee_bp, platform_fee_krw, seller_net_krw').eq('id', orderId).maybeSingle().then(({ data }) => setFee(data));
    void listDisputesForOrders([orderId]).then((r) => r.ok && setDispute(r.data.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null));
  }, [orderId, role]);

  const disputable = ['paid', 'shipped', 'delivered'].includes(status);
  return (
    <div className="eco-stack" style={{ marginTop: 6 }} data-testid="gear-order-extras">
      {role === 'seller' && fee?.platform_fee_krw != null && (
        <div className="eco-meta" data-testid="gear-order-fee">
          플랫폼 수수료 {formatWon(fee.platform_fee_krw)} ({(fee.fee_bp ?? 0) / 100}%, 상품가 기준) · 판매자 정산 예정 {formatWon(fee.seller_net_krw)} — 수수료는 배송 완료된 거래에만 발생합니다. 판매자 정산(지급)은 아직 지원하지 않습니다.
        </div>
      )}
      {dispute && <div className="eco-meta">분쟁: {GEAR_DISPUTE_LABEL[dispute.reason]} · {DISPUTE_STATUS[dispute.status]}{dispute.resolution_note ? ` · ${dispute.resolution_note}` : ''}</div>}
      {disputable && dispute?.status !== 'open' && (
        !open ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} data-testid="gear-dispute-open">거래 분쟁 신고</button>
        ) : (
          <div className="eco-form">
            <select value={reason} onChange={(e) => setReason(e.target.value as GearDisputeReason)} aria-label="분쟁 사유">
              {(Object.keys(GEAR_DISPUTE_LABEL) as GearDisputeReason[]).map((r) => <option key={r} value={r}>{GEAR_DISPUTE_LABEL[r]}</option>)}
            </select>
            <textarea value={detail} maxLength={2000} onChange={(e) => setDetail(e.target.value)} placeholder="상황을 설명해 주세요" />
            <div className="eco-row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={async () => {
                const r = await openGearDispute(orderId, reason, detail);
                if (!r.ok) return setErr(r.message);
                setDispute(r.data);
                setOpen(false);
              }} data-testid="gear-dispute-submit">신고</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>취소</button>
            </div>
          </div>
        )
      )}
      {err && <p className="gear-error" role="alert">{err}</p>}
    </div>
  );
}
