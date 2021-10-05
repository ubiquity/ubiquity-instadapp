import { computed, readonly, ref, watch } from "@nuxtjs/composition-api";
import { useWeb3 } from "@instadapp/vue-web3";
import DSA from "dsa-connect";
import addresses from "~/constant/addresses";
import abis from "~/constant/abis";
import { AbiItem } from "web3-utils";
import { useNotification } from "./useNotification";
import { useNetwork } from "./useNetwork";

const dsa = ref<DSA>();
const accounts = ref<any[]>([]);
const activeAccount = ref<any>();
const authorities = ref<string[]>();

export function useDSA() {
  const { active, library, chainId, account } = useWeb3();
  const { activeNetworkId } = useNetwork()
  const { showWarning } = useNotification();

  watch(library, () => {
    if (library.value) {
      dsa.value = new DSA(library.value, chainId.value);
    }
  });


  watch(active, () => {
    if (library.value) {
      dsa.value = new DSA(library.value, chainId.value);
    }
  });

  watch(chainId, () => {
    if (library.value) {
      dsa.value = new DSA(library.value, chainId.value);
    }
  });

  const refreshAccounts = async () => {
    accounts.value = await dsa.value.getAccounts(account.value);

      if (accounts.value.length > 0) {
        activeAccount.value = accounts.value[0];
      } else {
        activeAccount.value = undefined;
      }
  }

  watch(dsa, async () => {
    if (dsa.value) {
      refreshAccounts()
    }
  });

  watch(
    activeAccount,
    async () => {
      authorities.value = [];

      if (activeAccount.value) {
        dsa.value.setAccount(activeAccount.value.id);

        fethAuthorities();
      }
    },
    { immediate: true }
  );

  const creatingAccount = ref(false);
  const creatingAuthority = ref(false);
  const removingAuthority = ref(false);

  async function createAccount() {
    creatingAccount.value = true;
    try {
      const transactionHash = await dsa.value.build({ version: 2 });

      accounts.value = await dsa.value.getAccounts(account.value);
      return transactionHash;
    } catch (error) {
    } finally {
      creatingAccount.value = false;
    }
  }

  function setAccount(account: any) {
    activeAccount.value = account;
  }

  async function fethAuthorities() {
    try {
      const accountsResolverInstance = new library.value.eth.Contract(
        abis.resolver.accounts as AbiItem[],
        addresses[activeNetworkId.value].resolver.accounts
      );
      const rawData = await accountsResolverInstance.methods
        .getAccountAuthorities(activeAccount.value.address)
        .call();

      authorities.value = rawData;
    } catch (error) {}
  }

  async function createAuthority(newAuthority: string) {
    try {
      if (!newAuthority) {
        return;
      }

      const owners = authorities.value.map(x => x.toLowerCase());

      if (owners.includes(newAuthority.toLowerCase())) {
        showWarning("Create Authority", "Account is already an owner!");
        return;
      }
      creatingAuthority.value = true;

      const spells = dsa.value.Spell();

      spells.add({
        connector: "authority",
        method: "add",
        args: [newAuthority]
      });

      const transactionHash = await dsa.value.cast({
        spells,
        from: account.value
      });

      creatingAuthority.value = false;

      fethAuthorities();

      return transactionHash;
    } catch (error) {
      creatingAuthority.value = false;
    }
  }

  async function removeAuthority(authority) {
    try {
      if (authorities.value.length <= 1) {
        showWarning("Remove Authority", "Cannot remove all authorities!");
        return;
      }
      removingAuthority.value = true;

      const spells = dsa.value.Spell();

      spells.add({
        connector: "authority",
        method: "remove",
        args: [authority]
      });

      const transactionHash = await dsa.value.cast({
        spells,
        from: account.value
      });

      removingAuthority.value = false;

      fethAuthorities();

      return transactionHash;
    } catch (error) {
      removingAuthority.value = false;
    }
  }

  return {
    dsa,
    refreshAccounts,
    activeAccount: readonly(activeAccount),
    accounts,
    createAccount,
    creatingAccount,
    setAccount,
    library,
    chainId,
    authorities,
    createAuthority,
    creatingAuthority,
    removeAuthority,
    removingAuthority
  };
}
