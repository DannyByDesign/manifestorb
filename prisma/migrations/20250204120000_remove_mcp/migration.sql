-- DropForeignKey
ALTER TABLE "McpTool" DROP CONSTRAINT "McpTool_connectionId_fkey";

-- DropForeignKey
ALTER TABLE "McpConnection" DROP CONSTRAINT "McpConnection_integrationId_fkey";

-- DropForeignKey
ALTER TABLE "McpConnection" DROP CONSTRAINT "McpConnection_emailAccountId_fkey";

-- DropTable
DROP TABLE "McpTool";

-- DropTable
DROP TABLE "McpConnection";

-- DropTable
DROP TABLE "McpIntegration";
