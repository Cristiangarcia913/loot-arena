require("@nomicfoundation/hardhat-toolbox");
// Carga contracts/.env si existe; si no, simplemente no hace nada.
require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

// Acepta la clave con o sin prefijo 0x; si no es válida, no se pasan cuentas
// (así compilar o testear nunca falla por un .env vacío).
function cuentas() {
  const k = PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
  return /^0x[0-9a-fA-F]{64}$/.test(k) ? [k] : [];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // OpenZeppelin 5.x usa mcopy (Cancun); Sepolia y la red Hardhat lo soportan.
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    sepolia: {
      url: SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts: cuentas(),
      // El RPC público a veces estima propina ~0 y las tx se quedan atascadas: precio fijo.
      gasPrice: 10_000_000, // 0,01 gwei: la tarifa base de Sepolia es ínfima
    },
  },
  etherscan: {
    // Etherscan API v2: una sola clave sirve para todas las redes.
    apiKey: ETHERSCAN_API_KEY,
  },
  sourcify: { enabled: false },
};
