import { computed, Ref, ref, watch } from "@nuxtjs/composition-api";
import BigNumber from "bignumber.js";
BigNumber.config({ POW_PRECISION: 200 });
import abis from "~/constant/abis";
import addresses from "~/constant/addresses";
import reflexerSafes from "~/constant/tokens/safes";
import { useBigNumber } from "~/composables/useBigNumber";
import { useDSA } from "~/composables/useDSA";
import { useToken } from "~/composables/useToken";
import { useWeb3 } from "@instadapp/vue-web3";
import { AbiItem } from "web3-utils";
import { useBalances } from "../useBalances";

const defaultSafe = {
  id: null,
  tokenKey: "eth",
  token: "ETH",
  collateralName: "ETH-A",
  collateral: "0",
  debt: "0",
  liquidatedCollateral: "0",
  status: "0",
  rate: "0",
  liquidation: "0",
  price: "0",
  netvalue: "0"
};

const oracleRelayerAddress = "0x4ed9C0dCa0479bC64d8f4EB3007126D5791f7851";

const safeId = ref(null);
const safes = ref([]);
const isNewSafe = ref(false);
const safeTypes = ref([]);
const safeType = ref("");

const safe = computed(() => {
  const vlt = safes.value.find(v => v.id === safeId.value);
  if (!isNewSafe.value && !!vlt) {
    return vlt;
  }

  const vt = safeTypes.value.find(vt => vt.type === safeType.value);
  if (vt) {
    return { ...defaultSafe, ...vt };
  }

  const defaultSafeType = safeTypes.value[0];
  if (defaultSafeType) {
    return { ...defaultSafe, ...defaultSafeType };
  }

  return defaultSafe;
});

export function useReflexerPosition(
  collateralAmountRef: Ref = null,
  debtAmountRef: Ref = null
) {
  const { library } = useWeb3();
  const { activeAccount } = useDSA();
  const { isZero, ensureValue, times, div, max, gt, toBN } = useBigNumber();
  const { getTokenByKey } = useToken();
  const { prices } = useBalances();

  const raiToken = computed(() => getTokenByKey("rai"));
  const raiInUsd = computed(() =>
    raiToken.value ? prices.mainnet[raiToken.value.address] || "0" : "0"
  );

  const safeTokenType = computed(() => safe.value.safeTokenType);

  const price = computed(() => ensureValue(safe.value.price).toFixed());
  const spotPrice = computed(() => ensureValue(safe.value.spotPrice).toFixed());

  const collateralUsd = computed(() =>
    times(collateral.value, price.value).toFixed()
  );
  const collateral = computed(() =>
    ensureValue(safe.value.collateral).toFixed()
  );

  const liquidation = computed(() =>
    ensureValue(safe.value.liquidation).toFixed()
  );
  const tokenKey = computed(() => safe.value.tokenKey);

  const token = computed(() => getTokenByKey(tokenKey.value));
  const symbol = computed(() => token.value.symbol ?? "ETH");
  const rate = computed(() => ensureValue(safe.value.rate).toFixed());
  const netValue = computed(() => ensureValue(safe.value.netValue).toFixed());

  const status = computed(() => {
    if (!collateralAmountRef || !debtAmountRef)
      return ensureValue(safe.value.status).toFixed();
    return isZero(collateralAmountRef.value) && !isZero(debtAmountRef.value)
      ? "1.1"
      : div(
          debtAmountRef.value,
          times(collateralAmountRef.value, spotPrice.value)
        ).toFixed();
  });

  const liquidationPrice = computed(() => {
    if (!collateralAmountRef || !debtAmountRef)
      return max(
        div(div(debt.value, collateral.value), liquidation.value),
        "0"
      ).toFixed();

    return isZero(collateralAmountRef.value) && !isZero(debtAmountRef.value)
      ? times(price.value, "1.1").toFixed()
      : max(
          div(
            div(debtAmountRef.value, collateralAmountRef.value),
            toBN(liquidation.value)
              .multipliedBy(spotPrice.value)
              .dividedBy(price.value)
          ),
          "0"
        ).toFixed();
  });

  const debt = computed(() => ensureValue(safe.value.debt).toFixed());
  const debtUsd = computed(() =>
    times(debt.value, raiInUsd.value).toFixed()
  );

  const minDebt = computed(
    () => safeTypes.value[0]?.totalDebt?.toString() || "699"
  );
  const debtCeilingReached = computed(() =>
    safeTypes.value?.some(v =>
      gt(v.overallTotalDebt, v.overallTotalDebtCeiling)
    )
  );

  const fetchPosition = async () => {
    if (!library.value) {
      return;
    }

    safeTypes.value = await getSafeTypes(library.value);

    if (!activeAccount.value) {
      return;
    }
    safes.value = await getSafes(activeAccount.value.address, library.value);
    if (safes.value.length > 0 && !safeId.value) {
      safeId.value = safes.value[0].id;
    }
  };

  watch(
    library,
    async val => {
      if (val) {
        fetchPosition();
      }
    },
    { immediate: true }
  );

  watch(
    activeAccount,
    async val => {
      if (val) {
        fetchPosition();
      }
    },
    { immediate: true }
  );

  const selectSafe = vid => {
    if (vid === safeId.value && !isNewSafe.value) return;
    safeId.value = vid;
    isNewSafe.value = false;
  };

  return {
    fetchPosition,
    safeId: computed(() => (isNewSafe.value ? "0" : safeId.value || "0")),
    selectSafe,
    safeTokenType,
    safe,
    safes,
    safeType,
    safeTypes,
    isNewSafe,
    collateralUsd,
    collateral,
    price,
    raiInUsd,
    liquidation,
    tokenKey,
    token,
    symbol,
    rate,
    netValue,
    status,
    liquidationPrice,
    liquidationMaxPrice: price,
    debt,
    debtUsd,
    minDebt,
    debtCeilingReached
  };
}

async function getSafeTypes(web3) {
  const reflexerResolveABI = abis.resolver.reflexer;
  const reflexerResolveAddr = addresses.mainnet.resolver.reflexer;

  const reflexerResolverInstance = new web3.eth.Contract(
    reflexerResolveABI as AbiItem[],
    reflexerResolveAddr
  );

  try {
    const rawData: any[] = await reflexerResolverInstance.methods
      .getColInfo(reflexerSafes.types)
      .call();

    const rawRedemptionPrice = await web3.eth.getStorageAt(
      oracleRelayerAddress,
      4
    );
    return reflexerSafes.allSafes.map(
      ({ type, token, key: tokenKey, disabled, safeTokenType }, i) => {
        const [rate, price, ratioCbyD, debtCeiling, totalDebt] = rawData[i];

        return {
          type,
          token,
          tokenKey,
          disabled,
          safeTokenType,
          rate: calRate(rate),
          redemptionPrice: new BigNumber(rawRedemptionPrice)
            .dividedBy(1e27)
            .toFixed(),
          spotPrice: new BigNumber(price).dividedBy(1e27).toFixed(),
          price: new BigNumber(price)
            .times(rawRedemptionPrice)
            .dividedBy(1e54)
            .toFixed(),
          liquidation: new BigNumber(1)
            .dividedBy(new BigNumber(ratioCbyD).dividedBy(1e27))
            .toFixed(),
          debtCeiling: debtCeiling,
          totalDebt: new BigNumber(totalDebt).multipliedBy(1.00002).toFixed()
        };
      }
    );
  } catch (error) {
    console.error(error);
    return [];
  }
}
async function getSafes(user, web3) {
  try {
    const reflexerResolveABI = abis.resolver.reflexer;
    const reflexerResolveAddr = addresses.mainnet.resolver.reflexer;

    const reflexerResolverInstance = new web3.eth.Contract(
      reflexerResolveABI as AbiItem[],
      reflexerResolveAddr
    );

    const rawData: any[] = await reflexerResolverInstance.methods
      .getSafes(user)
      .call();

    const rawRedemptionPrice = await web3.eth.getStorageAt(
      oracleRelayerAddress,
      4
    );
    return rawData.map(
      ([
        id,
        owner,
        type,
        collInWei,
        ,
        debtInWei,
        liquidatedColInWei,
        ratePerBlock,
        priceInWei,
        liquidationRatioCbyD,
        urn
      ]) => {
        const collateral = new BigNumber(collInWei).dividedBy(1e18);
        const debt = new BigNumber(debtInWei).dividedBy(1e18);
        const spotPrice = new BigNumber(priceInWei).dividedBy(1e27);
        const price = new BigNumber(priceInWei)
          .times(rawRedemptionPrice)
          .dividedBy(1e54);

        const safe = reflexerSafes.getSafeByType(type);

        return {
          id,
          owner,
          type,
          tokenKey: safe.key,
          token: safe.token,
          safeTokenType: safe.safeTokenType,
          collateral: collateral.toFixed(),
          debt: debt.toFixed(),
          liquidatedCollateral: new BigNumber(liquidatedColInWei)
            .dividedBy(1e18)
            .toFixed(),
          rate: calRate(ratePerBlock),
          price: price.toFixed(),
          spotPrice,
          liquidation: new BigNumber(1)
            .dividedBy(new BigNumber(liquidationRatioCbyD).dividedBy(1e27))
            .toFixed(),
          urn,
          netValue: collateral
            .multipliedBy(price)
            .minus(debt)
            .toFixed(),
          status: collateral.isZero()
            ? "0"
            : debt.dividedBy(collateral.multipliedBy(spotPrice)).toFixed()
        };
      }
    );
  } catch (error) {
    console.error(error);
    return [];
  }
}

function calRate(ilkRate) {
  try {
    return new BigNumber(ilkRate)
      .dividedBy(1e27)
      .pow(31545000)
      .minus(1)
      .toFixed(18);
  } catch (error) {
    console.log("error", error);
  }
}
