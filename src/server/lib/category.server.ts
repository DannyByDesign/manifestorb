import prisma from "@/server/db/client";

export type CategoryWithRules = {
  id: string;
  name: string;
  description: string | null;
  rules: Array<{ id: string; name: string }>;
};

export const getUserCategories = async ({
  emailAccountId,
}: {
  emailAccountId: string;
}) => {
  const categories = await prisma.category.findMany({
    where: { emailAccountId },
  });
  return categories;
};

export const getUserCategoriesWithRules = async ({
  emailAccountId,
}: {
  emailAccountId: string;
}) => {
  const categories = await prisma.category.findMany({
    where: { emailAccountId },
    select: {
      id: true,
      name: true,
      description: true,
    },
  });
  return categories.map((category) => ({
    ...category,
    rules: [],
  }));
};
