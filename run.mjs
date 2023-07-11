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
const ceramic = new CeramicClient("https://ceramic-temp.hirenodes.io/");

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

const linksComposite = await createComposite(
  ceramic,
  "./composites/00-Links.graphql"
);

const skillsComposite = await createComposite(
  ceramic,
  "./composites/00-Skills.graphql"
);

const settingsComposite = await createComposite(
  ceramic,
  "./composites/00-ModeSettings.graphql"
);

const genProfileSchema = readFileSync(
  "./composites/01-GenProfile.graphql",
  {
    encoding: "utf-8",
  }
)
  .replace("$MODESETTING_ID", settingsComposite.modelIDs[0])
  .replace("$LINKS_ID", linksComposite.modelIDs[0])
  .replace("$SKILLS_ID", skillsComposite.modelIDs[0]);

const genProfileComposite = await Composite.create({
  ceramic,
  schema: genProfileSchema,
});

const daoProfileComposite = await createComposite(
  ceramic,
  "./composites/02-DAOProfile.graphql"
);

const memberSchema = readFileSync("./composites/03-Member.graphql", {
  encoding: "utf-8",
}).replace("$DAOPROFILE_ID", daoProfileComposite.modelIDs[0]);

const memberComposite = await Composite.create({
  ceramic,
  schema: memberSchema,
});

const contributorSchema = readFileSync("./composites/04-Contributor.graphql", {
  encoding: "utf-8",
}).replace("$DAOPROFILE_ID", daoProfileComposite.modelIDs[0]);

const contributorComposite = await Composite.create({
  ceramic,
  schema: contributorSchema,
});

const daoProfileConnectSchema = readFileSync(
  "./composites/05-DAOProfile.Connect.graphql",
  {
    encoding: "utf-8",
  }
)
  .replace("$MEMBER_ID", memberComposite.modelIDs[1])
  .replace("$CONTRIBUTOR_ID", contributorComposite.modelIDs[1])
  .replace("$DAOPROFILE_ID", daoProfileComposite.modelIDs[0]);

const daoProfileConnectComposite = await Composite.create({
  ceramic,
  schema: daoProfileConnectSchema,
});

const delOfSchema = readFileSync(
  "./composites/06-DelegateOfProfile.graphql",
  {
    encoding: "utf-8",
  }
).replace("$DAOPROFILE_ID", daoProfileComposite.modelIDs[0]);

const delOfComposite = await Composite.create({
  ceramic,
  schema: delOfSchema,
});

const delCircleSchema = readFileSync(
  "./composites/07-DelegateCircleDist.graphql",
  {
    encoding: "utf-8",
  }
).replace("$DAOPROFILE_ID", daoProfileComposite.modelIDs[0]);

const delCircleComposite = await Composite.create({
  ceramic,
  schema: delCircleSchema,
});

const contributorProfileSchema = readFileSync(
  "./composites/08-ContributorProfile.graphql",
  {
    encoding: "utf-8",
  }
).replace("$DAOPROFILE_ID", daoProfileComposite.modelIDs[0]);

const contributorProfileComposite = await Composite.create({
  ceramic,
  schema: contributorProfileSchema,
});

const memberOfProfileSchema = readFileSync(
  "./composites/09-MemberProfile.graphql",
  {
    encoding: "utf-8",
  }
).replace("$DAOPROFILE_ID", daoProfileComposite.modelIDs[0])
 .replace("$GENERALPROFILE_ID", genProfileComposite.modelIDs[3])
 .replace("$DELEGATEOFPROFILE_ID", delOfComposite.modelIDs[1])
 .replace("$CONTRIBUTORPROF_ID", contributorProfileComposite.modelIDs[1])

const memberOfComposite = await Composite.create({
  ceramic,
  schema: memberOfProfileSchema,
});

const composite = Composite.from([
  linksComposite,
  skillsComposite,
  settingsComposite,
  genProfileComposite,
  daoProfileComposite,
  memberComposite,
  contributorComposite,
  daoProfileConnectComposite,
  delOfComposite,
  delCircleComposite,
  contributorProfileComposite,
  memberOfComposite
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
shell.exec(`composedb composite:compile definition.json runtime-composite.json`);
spinner.succeed("establishing graphiql server");
shell.exec(`composedb graphql:server --graphiql runtime-composite.json --port=5005`)


