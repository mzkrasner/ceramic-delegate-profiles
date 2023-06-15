import { readFileSync } from "fs";
import { CeramicClient } from "@ceramicnetwork/http-client";
import {
  createComposite,
  readEncodedComposite,
  writeEncodedComposite,
  writeEncodedCompositeRuntime,
} from "@composedb/devtools-node";
import { Composite } from "@composedb/devtools";
import shell from "shelljs";
import { fromString } from "uint8arrays/from-string";
import { DID } from "dids";
import { Ed25519Provider } from "key-did-provider-ed25519";
import { getResolver } from "key-did-resolver";
import ora from "ora";

const spinner = ora();
const ceramic = new CeramicClient("http://localhost:7007");

//Accessing your admin key to authenticate the session
const seed = shell.exec(
  `kubectl get secrets --namespace ceramic ceramic-admin -o json | jq -r '.data."private-key"' | base64 -d`
);
const key = fromString(seed.stdout, "base16");
const did = new DID({
  resolver: getResolver(),
  provider: new Ed25519Provider(key),
});

spinner.info("Authenticating ceramic admin");
await did.authenticate();
ceramic.did = did;
/**
 * @param {Ora} spinner - to provide progress status.
 * @return {Promise<void>} - return void when composite finishes deploying.
 */

const settingsComposite = await createComposite(
  ceramic,
  "./composites/00-ModeSettings.graphql"
);

const userProfileComposite = await createComposite(
  ceramic,
  "./composites/01-UserProfile.graphql"
);

const teamProfileComposite = await createComposite(
  ceramic,
  "./composites/02-Team.graphql"
);

const teamMemberSchema = readFileSync(
  "./composites/03-TeamMember.graphql",
  {
    encoding: "utf-8",
  }
)
  .replace("$USERPROFILE_ID", userProfileComposite.modelIDs[0])
  .replace("$TEAM_ID", teamProfileComposite.modelIDs[0]);

const teamMemberComposite = await Composite.create({
  ceramic,
  schema: teamMemberSchema,
});

const composite = Composite.from([
  settingsComposite,
  userProfileComposite,
  teamProfileComposite,
  teamMemberComposite,
]);

//Writing composites to local file
await writeEncodedComposite(composite, "./definition.json");
spinner.info("creating composite for runtime usage");
await writeEncodedCompositeRuntime(
  ceramic,
  "./definition.json",
  "./definition.js"
);
spinner.info("deploying composite");
const deployComposite = await readEncodedComposite(
  ceramic,
  "./definition.json"
);
const id = deployComposite.modelIDs;
spinner.info(`Deployed the following models: ${id}`);
await deployComposite.startIndexingOn(ceramic);
spinner.succeed("composite deployed & ready for use");
spinner.succeed("compiling composite into runtime composite");
shell.exec(
  `composedb composite:compile definition.json runtime-composite.json`
);
spinner.succeed("establishing graphiql server");
shell.exec(
  `composedb graphql:server --graphiql runtime-composite.json --port=5005`
);
