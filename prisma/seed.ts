import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';

async function main() {
  // Limpiar en orden correcto por las foreign keys (de hijo a padre).
  await prisma.ticket.deleteMany();
  await prisma.deployment.deleteMany();
  await prisma.providerCredential.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  const users = await Promise.all([
    prisma.user.create({
      data: {
        name: 'Admin',
        email: 'admin@devops.io',
        password: await hashPassword('admin12345'),
        role: 'ADMIN',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Dev',
        email: 'dev@devops.io',
        password: await hashPassword('dev123456'),
        role: 'DEVELOPER',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Viewer',
        email: 'viewer@devops.io',
        password: await hashPassword('viewer1234'),
        role: 'VIEWER',
      },
    }),
  ]);

  const projects = await Promise.all([
    prisma.project.create({
      data: {
        name: 'Vercel landing',
        provider: 'VERCEL',
        providerConfig: { vercelProjectId: 'prj_demo_landing' },
      },
    }),
    prisma.project.create({
      data: {
        name: 'API Jenkins core',
        provider: 'JENKINS',
        providerConfig: { jobName: 'backend-core', jenkinsUrl: 'http://jenkins:8080' },
      },
    }),
    prisma.project.create({
      data: {
        name: 'Web GitHub Actions',
        provider: 'GITHUB_ACTIONS',
        providerConfig: { owner: 'you', repo: 'devops-dashboard' },
      },
    }),
    prisma.project.create({
      data: {
        name: 'App AWS ECS',
        provider: 'AWS',
        providerConfig: { cluster: 'demo-cluster', service: 'api' },
      },
    }),
  ]);

  const vercelProject = projects.find((p) => p.provider === 'VERCEL')!;
  const now = Date.now();

  const deployments = await Promise.all([
    prisma.deployment.create({
      data: {
        projectId: vercelProject.id,
        provider: 'VERCEL',
        status: 'SUCCESS',
        externalId: 'dpl_seed_1',
        commitSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        url: 'https://landing-demo.vercel.app',
        durationMs: 87_000,
        startedAt: new Date(now - 3 * 60 * 60 * 1000),
        finishedAt: new Date(now - 3 * 60 * 60 * 1000 + 87_000),
      },
    }),
    prisma.deployment.create({
      data: {
        projectId: vercelProject.id,
        provider: 'VERCEL',
        status: 'FAILED',
        externalId: 'dpl_seed_2',
        commitSha: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
        url: 'https://landing-demo.vercel.app',
        durationMs: 12_000,
        startedAt: new Date(now - 2 * 60 * 60 * 1000),
        finishedAt: new Date(now - 2 * 60 * 60 * 1000 + 12_000),
      },
    }),
    prisma.deployment.create({
      data: {
        projectId: vercelProject.id,
        provider: 'VERCEL',
        status: 'RUNNING',
        externalId: 'dpl_seed_3',
        commitSha: 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
        url: 'https://landing-demo.vercel.app',
        startedAt: new Date(now - 60 * 1000),
      },
    }),
  ]);

  console.log(
    `Seed completado: ${users.length} usuarios, ${projects.length} proyectos, ${deployments.length} deployments.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
