import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ErrorState from '../../components/ErrorState';
import LoadingState from '../../components/LoadingState';
import { CheckoutPanel, CoinAmount, MonoPage, TestPaymentNotice } from '../../components/monetization/shared';
import { formatWon } from '../../lib/ecosystem/common';
import { createCoinCheckout, formatCoins, listCoinPackages, type CoinPackage } from '../../lib/monetization/service';
import { useMembership } from '../../lib/monetization/useMembership';

export default function CoinStore() {
  const { membership } = useMembership();
  const [packs, setPacks] = useState<CoinPackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void listCoinPackages().then((r) => (r.ok ? setPacks(r.data.filter((p) => p.active)) : setError(r.message)));
  }, []);

  return (
    <MonoPage
      kicker="COIN STORE"
      title="코인 스토어"
      icon="coin"
      fallback="/wallet"
      lede="MARTIAL COIN 은 프리미엄 콘텐츠·창작자 강의·프로필 아이템 구매에 씁니다. 확률형 상품은 판매하지 않습니다."
      actions={<Link className="btn btn-ghost btn-sm" to="/wallet">내 지갑</Link>}
    >
      <TestPaymentNotice />
      {membership?.privileged && <p className="eco-notice eco-notice--accent">운영자·개발자 계정은 코인 없이 모든 콘텐츠를 이용할 수 있습니다.</p>}
      {error && <ErrorState text={error} />}
      {notice && <p className="eco-notice eco-notice--accent" role="status" data-testid="store-notice">{notice}</p>}
      {!packs ? (
        <LoadingState />
      ) : (
        <div className="mono-packs" data-testid="coin-packages">
          {packs.map((p) => (
            <article key={p.id} className="mono-pack" data-testid={`pack-${p.id}`}>
              <h3>{p.name}</h3>
              <CoinAmount value={p.coins + p.bonus_coins} size="lg" />
              <div className="eco-meta">
                {formatCoins(p.coins)} MC{p.bonus_coins > 0 && <> + 보너스 <strong>{formatCoins(p.bonus_coins)}</strong></>}
              </div>
              <div className="mono-pack__price">{formatWon(p.price_krw)}</div>
              <CheckoutPanel
                kind="coin"
                title={`${p.name} 구매`}
                create={() => createCoinCheckout(p.id)}
                onDone={(o) => setNotice(`${formatCoins((o.coins ?? 0) + (o.bonusCoins ?? 0))} MC 가 지급되었습니다. (테스트 결제)`)}
                testId={`checkout-pack-${p.id}`}
              />
            </article>
          ))}
        </div>
      )}
      <p className="eco-meta--faint">
        코인은 MARTIALDEX 안에서만 사용되며 현금으로 교환되지 않습니다. 결제 후 7일 이내, 지급된 코인을 사용하지 않았다면 내 지갑에서 환불을 요청할 수 있습니다. 결제 금액·지급량은 서버가 정합니다.
      </p>
    </MonoPage>
  );
}
