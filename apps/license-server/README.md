# Serveur de comptes et licences

Comptes, appareils, licences signées et abonnement Pro (Stripe) pour TokTok Game Connector Live.
Express 5 + PostgreSQL, déployé sur Railway.

## Espace web

Le serveur sert aussi l'**espace web** public (`public/`, HTML/CSS/JS sans dépendance) :
accueil, catalogue des jeux compatibles avec guide d'installation, téléchargement de l'app (dernière version
lue sur GitHub Releases), Gratuit / Pro, compte (connexion web par cookie de session `HttpOnly`,
`SameSite=Strict` + contrôle d'origine, sans occuper de place d'appareil) et confidentialité. CSP stricte :
aucun script ni style en ligne, aucune ressource externe sauf l'API GitHub.

Routes web : `POST /v1/web/register|login|logout|checkout|portal`, `GET /v1/web/me`, `DELETE /v1/web/devices/:id`.

## Fonctionnement

- **Compte** : email + mot de passe (scrypt). 3 appareils maximum par compte (`MAX_DEVICES`) ; à la
  connexion d'un 4ᵉ, l'app propose d'en déconnecter un.
- **Licence** : jeton signé en **Ed25519** (`payload.signature`, base64url) contenant le plan (`free` / `pro`),
  l'appareil et une date d'expiration (7 jours, `LICENSE_TTL_DAYS`). L'app le vérifie **hors ligne** avec la
  clé publique intégrée, le renouvelle chaque jour et reste Pro jusqu'à 7 jours sans Internet.
- **Pro** : abonnement Stripe (Checkout + portail client) ou accordé par un admin (créateurs, partenaires).
  `active`, `trialing` et `past_due` gardent le Pro jusqu'à la fin de la période payée (+ 1 jour de tolérance).
- **RGPD** : suppression du compte depuis l'app (annule l'abonnement Stripe, efface les appareils).

## API (JSON)

| Route                                                                               | Auth             | Rôle                                                                       |
| ----------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| `POST /v1/auth/register` `{email, password, deviceId, deviceName}`                  | —                | Crée le compte → `{deviceToken, license, account}`                         |
| `POST /v1/auth/login` (+ `replaceDevice` facultatif)                                | —                | Connexion ; `409 device_limit` avec la liste des appareils                 |
| `POST /v1/auth/logout` · `POST /v1/auth/password`                                   | appareil         | Déconnexion · changement de mot de passe (déconnecte les autres appareils) |
| `POST /v1/license` · `GET /v1/account`                                              | appareil         | Licence renouvelée · état du compte                                        |
| `DELETE /v1/devices/:id` · `DELETE /v1/account {password}`                          | appareil         | Retirer un appareil · supprimer le compte                                  |
| `POST /v1/billing/checkout {interval: monthly\|yearly}` · `POST /v1/billing/portal` | appareil         | URL Stripe                                                                 |
| `POST /stripe/webhook`                                                              | signature Stripe | `checkout.session.completed`, `customer.subscription.*`                    |
| `POST /admin/grant {email, pro, until?}` · `POST /admin/reset-password {email}`     | `ADMIN_TOKEN`    | Pro manuel · mot de passe temporaire                                       |
| `GET /health`                                                                       | —                | Santé                                                                      |

« appareil » = `Authorization: Bearer <deviceToken>` (stocké chiffré par l'app, haché en SHA-256 côté serveur).

## Variables d'environnement

| Variable                                          | Rôle                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                    | PostgreSQL (référence Railway `${{Postgres.DATABASE_URL}}`)                                            |
| `LICENSE_PRIVATE_KEY`                             | Clé privée Ed25519 (PEM ou PEM en base64). `npm run keygen` en génère une. **Ne jamais la committer.** |
| `PUBLIC_URL`                                      | URL publique du service (pages de retour Stripe)                                                       |
| `ADMIN_TOKEN`                                     | Jeton des routes `/admin` (24 caractères minimum)                                                      |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`      | Sans elles, le paiement est désactivé (le reste fonctionne)                                            |
| `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`     | ID des prix récurrents (`price_…`) créés dans Stripe                                                   |
| `MAX_DEVICES` (3), `LICENSE_TTL_DAYS` (7), `PORT` | Réglages                                                                                               |

### Configurer Stripe

1. Dans Stripe : créer le produit « TokTok Pro » avec un prix mensuel et/ou annuel → copier les `price_…`.
2. Développeurs → Webhooks → ajouter l'endpoint `https://<domaine>/stripe/webhook` avec les événements
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted` → copier le secret `whsec_…`.
3. Activer le portail client (Paramètres → Facturation → Portail client).
4. Renseigner les variables ci-dessus sur Railway (clés de test `sk_test_…` d'abord).

### Accorder le Pro à quelqu'un

```bash
curl -X POST https://<domaine>/admin/grant -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"email":"createur@exemple.fr","pro":true}'
```

`"until":"2026-12-31T23:59:59Z"` pour une durée limitée, `"pro":false` pour retirer.

## Clé de licence

La clé publique est servie sur `GET /v1/public-key` et intégrée à l'app
(`packages/core/src/license/public-key.ts`). Pour changer de clé : définir une nouvelle `LICENSE_PRIVATE_KEY`
(ou vider la table `server_keys`), publier une version de l'app avec la nouvelle clé publique ; les licences déjà
émises restent valides au plus `LICENSE_TTL_DAYS` jours.
