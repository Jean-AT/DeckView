pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  environment {
    // Registry real: cambia a tu Docker Hub / GHCR / ECR. Con credenciales en Manage Credentials.
    DOCKER_REGISTRY = 'docker.io'
    IMAGE_NAME      = 'jeanat/devops-dashboard-backend'
    IMAGE_TAG       = "${env.BRANCH_NAME}-${env.BUILD_NUMBER}"
    FULL_IMAGE      = "${DOCKER_REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"

    // Base de datos efímera para el stage de test (Postgres en contenedor Docker).
    DATABASE_URL = 'postgresql://postgres:postgres@localhost:5433/devops_dashboard'

    // Secret Text en Jenkins → Manage Credentials → Add Credentials.
    JWT_SECRET             = credentials('JWT_SECRET')
    JWT_REFRESH_SECRET     = credentials('JWT_REFRESH_SECRET')
    CREDENTIALS_MASTER_KEY = credentials('CREDENTIALS_MASTER_KEY')
  }

  parameters {
    booleanParam(name: 'DEPLOY', defaultValue: false,
      description: 'Desplegar a producción al terminar la pipeline (requiere DEPLOY_HOST)')
    string(name: 'DEPLOY_HOST', defaultValue: '',
      description: 'Host SSH para el deploy, ej: ubuntu@1.2.3.4')
  }

  stages {
    stage('install') {
      steps {
        sh 'npm ci'
      }
    }

    stage('audit') {
      steps {
        sh 'npm audit --omit=dev --audit-level=high'
      }
    }

    stage('lint') {
      steps {
        sh 'npm run lint'
      }
    }

    stage('type-check') {
      steps {
        sh 'npm run typecheck'
      }
    }

    stage('test') {
      steps {
        sh '''
          set -e
          NAME="ci-postgres-${BUILD_NUMBER}"
          docker run -d --name "$NAME" \
            -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
            -e POSTGRES_DB=devops_dashboard -p 5433:5432 postgres:16-alpine
          trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
          for i in $(seq 1 30); do
            docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
            sleep 1
          done
          npm run prisma:deploy
          npm test
        '''
      }
    }

    stage('build') {
      steps {
        sh 'npm run build'
      }
    }

    stage('docker build') {
      steps {
        sh 'docker build -t "${FULL_IMAGE}" .'
      }
    }

    stage('push') {
      steps {
        // ID de credenciales con login al registry (Docker Hub / GHCR / ECR).
        withDockerRegistry([credentialsId: 'DOCKER_REGISTRY_CREDS', url: 'https://index.docker.io/v1/']) {
          sh 'docker push "${FULL_IMAGE}"'
        }
      }
    }

    stage('deploy') {
      when {
        expression { params.DEPLOY && params.DEPLOY_HOST.trim() != '' }
      }
      steps {
        // ID de credenciales con la llave privada SSH del servidor EC2.
        sshagent(credentials: ['DEPLOY_SSH_KEY']) {
          sh '''
            ssh -o StrictHostKeyChecking=no "${DEPLOY_HOST}" \
              "cd ~/devops-dashboard && export TAG=${IMAGE_TAG} && docker compose up -d --no-deps backend && docker image prune -f"
          '''
        }
      }
    }
  }

  post {
    always {
      sh 'docker rm -f "ci-postgres-${BUILD_NUMBER}" >/dev/null 2>&1 || true'
      cleanWs(cleanWhenAborted: true, cleanWhenFailure: true, cleanWhenNotBuilt: true, cleanWhenSuccess: true, deleteDirectories: true)
    }
  }
}