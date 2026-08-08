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

  console.log(`Seed completado: ${users.length} usuarios, ${projects.length} proyectos.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
