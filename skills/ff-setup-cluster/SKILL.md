---
name: ff-setup-cluster
description: Bootstrap a local FireFoundry cluster from scratch
user_invocable: true
argument: minikube profile name (default: minikube)
---

# Local FireFoundry Cluster Setup

Bootstrap a local minikube cluster with the FireFoundry control plane and an environment, ready for agent bundle development.

## 1. Resolve profile name

Use the provided argument as the minikube profile name. Default to `minikube` if none given.

## 2. Check prerequisites

Verify these are available before proceeding:

```bash
which minikube && minikube version
which kubectl
which helm
which ff-cli && ff-cli version
ls ~/.ff/license.jwt
```

If any are missing, tell the user what's needed and stop.

## 3. Start minikube

```bash
minikube start -p <profile> --cpus 6 --memory 8176m --driver=docker
kubectl config use-context <profile>
```

Verify the context switched: `kubectl config current-context` should return the profile name.

## 4. Create or select ff-cli profile

ff-cli profiles store deployment configuration. Check if one exists for this minikube context:

```bash
ff-cli profile list
```

If no profile exists with `kubectl-context: <profile>`, create one:

```bash
ff-cli profile create <profile> --kubectl-context <profile> --registry-type Minikube --use
```

If a matching profile exists, select it:

```bash
ff-cli profile select <profile-name>
```

## 5. Initialize cluster

```bash
ff-cli cluster init --license ~/.ff/license.jwt
```

Expected: Namespace `ff-control-plane` created, Flux CRDs installed, ESO CRDs installed, registry secret created. Ignore `unrecognized format "int64"` warnings — they're cosmetic.

## 6. Install control plane

```bash
ff-cli cluster install --self-serve --license ~/.ff/license.jwt --cluster-type local -y
```

Expected: Completes within 12 minutes.

Wait for all pods to be ready:

```bash
kubectl wait --for=condition=Ready pods --all -n ff-control-plane --timeout=300s
```

Verify health:

```bash
kubectl get pods -n ff-control-plane
kubectl get pods -n ff-control-plane --field-selector=status.phase!=Running,status.phase!=Succeeded
```

Expected: 7 Running pods (kong, postgresql, agent-bundle-controller, ff-console, helm-api, source-controller, helm-controller) plus 2 Completed jobs. Zero unhealthy.

## 7. Start Kong port-forward

```bash
nohup kubectl port-forward -n ff-control-plane svc/firefoundry-control-kong-proxy 8000:9080 > /tmp/kong-pf.log 2>&1 &
sleep 5
```

Verify the Helm API is reachable:

```bash
ff-cli env list
```

Expected: Empty list or list of environments. If this fails, check `/tmp/kong-pf.log` and restart the port-forward.

## 8. Create environment

```bash
ff-cli env create -t minimal-self-contained -n <env-name> -y
```

Replace `<env-name>` with the user's desired environment name (e.g., `ff-dev`).

Expected: Environment created with 6 services (ff-broker, context-service, code-sandbox, entity-service, doc-proc-service, websearch-service).

Wait for it to be ready:

```bash
kubectl wait helmrelease/firefoundry-core -n <env-name> --for=condition=Ready --timeout=600s
```

If this times out, check:

```bash
kubectl get pods -n <env-name>
kubectl get helmrelease -n <env-name> firefoundry-core -o yaml | tail -20
```

## 9. Verify

```bash
kubectl get pods -n <env-name>
kubectl get pods -n <env-name> --field-selector=status.phase!=Running,status.phase!=Succeeded
```

Expected: All service pods Running, migration jobs Completed, zero unhealthy.

Report the cluster state to the user: control plane chart version, environment chart version, helm-api version, and pod counts.
