import Web3 from 'web3';
import React, {useState, useEffect, useCallback} from 'react';
import {Drizzle} from '@drizzle/store';
import {useWallet} from 'use-wallet';
import ERC20 from '../contracts/ERC20';
import YieldDelegatingVault from '../contracts/YieldDelegatingVault';
import NoMintLiquidityRewardPools from '../contracts/NoMintLiquidityRewardPools';

export const DrizzleContext = React.createContext();

// y Tokens addresses  for (deposityToken, withdrawyToken)
const Y_TOKEN_ADDRESSES = {
  USDC: '0x597ad1e0c13bfe8025993d9e79c69e1c0233522e',
  YCRV: '0x5dbcF33D8c2E976c6b560249878e6F1491Bca25c',
  TUSD: '0x37d19d1c4E1fa9DC47bD1eA12f742a0887eDa74a',
  DAI: '0xACd43E627e64355f1861cEC6d3a6688B31a6F952',
  USDT: '0x2f08119C6f07c006695E079AAFc638b8789FAf18',
  YFI: '0xBA2E7Fed597fd0E3e70f5130BcDbbFE06bB94fe1',
  crvBUSD: '0x2994529C0652D127b7842094103715ec5299bBed',
  crvBTC: '0x7Ff566E1d69DEfF32a7b244aE7276b9f90e9D0f6',
  WETH: '0xe1237aA7f535b0CC33Fd973D66cBf830354D16c7',
};

// Loaded from migration addresses
const VAULT_ADDRESSES = {
  USDC: '0xF7a280F71f3a31e4eeBa6deC7923768f0f1B91Ae',
  YCRV: '0xeb93eB72947C74a251e90B3cd609A97543a134Ee',
  TUSD: '0xA7FEEe9E857e8A268f1fEDa32b0bfDe48c2562D5',
  DAI: '0x92970B7c3a5Fa9079996A530E9Bc4A463EF2146F',
  USDT: '0x8E9550F541Ab6a9ebdE3b4be01395D93a96379BA',
  YFI: '0xDe495d944495513949cbF151F3b79B0c8e0C9F9F',
  crvBUSD: '0xC197baA12F133B4187573572AA7f624B126877fF',
  crvBTC: '0x53aeA77b1692a821f09b8147171B581bB062D407',
  WETH: '0x1574db2A77D4D5A1104A343c24A51ea955565C71',
};

const CONTRACT_LOADING_STATE = {
  NONE: 0,
  LOADING: 1,
  DONE: 2,
};

export const DrizzleProvider = ({children}) => {
  const {ethereum, status} = useWallet();
  const [drizzle, setDrizzle] = useState(null);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingContracts, setLoadingContracts] = useState([]);
  const [loadingContractsState, setLoadingContractsState] = useState(
    CONTRACT_LOADING_STATE.NONE
  );
  const [initialized, setInitialized] = useState(false);

  const connect = useCallback(() => {
    const web3 = new Web3(ethereum);
    (async () => {
      setLoading(true);
      // let drizzle know what contracts we want and how to access our test blockchain
      const options = {
        web3: {
          customProvider: web3,
          fallback: {
            type: 'ws',
            url: 'ws://127.0.0.1:9545',
          },
        },
      };

      const loaded = new Drizzle(options);
      // setup the drizzle store and drizzle
      setDrizzle(loaded);
    })();
  }, [ethereum]);

  useEffect(() => {
    if (!drizzle) {
      return;
    }

    const unsubscribe = drizzle.store.subscribe(() => {
      // every time the store updates, grab the state from drizzle
      const drizzleState = drizzle.store.getState();
      // check to see if it's ready, if so, update local component state
      if (drizzleState.drizzleStatus.initialized) {
        setState(drizzleState);
        setLoading(false);
      }
    });

    return unsubscribe;
  }, [drizzle]);

  useEffect(() => {
    if (
      (loading && !initialized) ||
      !drizzle ||
      initialized ||
      loadingContractsState !== CONTRACT_LOADING_STATE.NONE
    ) {
      return;
    }

    setLoadingContractsState(CONTRACT_LOADING_STATE.LOADING);
    let contracts = [
      ...Object.entries(VAULT_ADDRESSES).map(([key, value]) => ({
        contractName: `yVault${key}`,
        web3Contract: new drizzle.web3.eth.Contract(YieldDelegatingVault.abi, value),
      })),
      ...Object.entries(Y_TOKEN_ADDRESSES).map(([key, value]) => ({
        contractName: `yToken${key}`,
        web3Contract: new drizzle.web3.eth.Contract(ERC20.abi, value),
      })),
      {
        contractName: 'NoMintLiquidityRewardPools',
        web3Contract: new drizzle.web3.eth.Contract(
          NoMintLiquidityRewardPools.abi,
          '0x7A942fF3B4291bEf302ba5BEA050CBa3E2c09C61'
        ),
      },
    ];

    contracts.map(c => {
      return drizzle.addContract(c);
    });

    (async () => {
      // Underlying token for (deposit, withdraw, withdrawAll)
      const tokens = await Promise.all(
        Object.keys(VAULT_ADDRESSES).map(async key => {
          console.log(`Loading ${key}`);
          return new Promise(async resolve => {
            console.log(drizzle.contracts[`yVault${key}`]);
            const tokenAddress = await drizzle.contracts[`yVault${key}`].methods
              .token()
              .call()
              .catch(e => {
                console.error('Opps', e);
              });

            console.log(`[token-${key}] Loaded.`);

            resolve({
              contractName: key,
              web3Contract: new drizzle.web3.eth.Contract(ERC20.abi, tokenAddress),
            });
          });
        })
      );

      const poolLength = await drizzle.contracts.NoMintLiquidityRewardPools.methods
        .poolLength()
        .call();

      const pools = await Promise.all(
        Array.from({length: poolLength}).map(async (_v, i) => {
          return new Promise(async resolve => {
            const info = await drizzle.contracts.NoMintLiquidityRewardPools.methods
              .poolInfo(i)
              .call();

            resolve({
              contractName: `Pool_${i}`,
              web3Contract: new drizzle.web3.eth.Contract(ERC20.abi, info.lpToken),
            });
          });
        })
      );

      [...tokens, ...pools].map(c => {
        return drizzle.addContract(c);
      });

      setLoadingContracts([...contracts, ...pools, ...tokens]);
      setLoadingContractsState(CONTRACT_LOADING_STATE.DONE);
    })();
  }, [drizzle, initialized, loading, loadingContracts, loadingContractsState]);

  useEffect(() => {
    if (
      !drizzle ||
      initialized ||
      loadingContractsState !== CONTRACT_LOADING_STATE.DONE ||
      loadingContracts.length === 0
    ) {
      return;
    }

    // This makes sure that all the contracts that we added are actually loaded
    setInitialized(drizzle.contractList.length === loadingContracts.length);
  }, [drizzle, initialized, loading, loadingContracts, loadingContractsState]);

  useEffect(() => {
    if (status !== 'connected') {
      return;
    }

    if (drizzle) {
      return;
    }

    // We should be connected, let's connect drizzle
    connect();
  }, [connect, status, drizzle]);

  return (
    <DrizzleContext.Provider value={{loading, initialized, drizzle, state, connect}}>
      {children}
    </DrizzleContext.Provider>
  );
};
