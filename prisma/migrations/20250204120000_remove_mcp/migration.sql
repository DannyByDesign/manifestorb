-- DropForeignKey
ALTER TABLE IF EXISTS "McpTool" DROP CONSTRAINT IF EXISTS "McpTool_connectionId_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "McpConnection" DROP CONSTRAINT IF EXISTS "McpConnection_integrationId_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "McpConnection" DROP CONSTRAINT IF EXISTS "McpConnection_emailAccountId_fkey";

-- DropTable
DROP TABLE IF EXISTS "McpTool";

-- DropTable
DROP TABLE IF EXISTS "McpConnection";

-- DropTable
DROP TABLE IF EXISTS "McpIntegration";
