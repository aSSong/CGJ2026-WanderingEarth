import { defineConfig } from "vite";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const isUserOrOrgPagesSite = repositoryName?.endsWith(".github.io");

export default defineConfig({
  base:
    process.env.GITHUB_ACTIONS && repositoryName && !isUserOrOrgPagesSite
      ? `/${repositoryName}/`
      : "/",
});
