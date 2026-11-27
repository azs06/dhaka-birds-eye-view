// The landmark registry: every landmark that lives in its own file. Each file
// default-exports a LandmarkModule, or `null` while it is still a stub; this
// list is complete, so building a landmark means editing its own file only.
// app/BirdFlight.tsx turns every non-null module into a landmark.
import type { LandmarkModule } from "./kit";
import dhakaGate from "./dhaka-gate";
import bangabhaban from "./bangabhaban";
import oldHighCourt from "./old-high-court";
import banglaAcademy from "./bangla-academy";
import shilpakalaAcademy from "./shilpakala-academy";
import dhakaNewMarket from "./dhaka-new-market";
import nilkhetBookMarket from "./nilkhet-book-market";
import intercontinentalDhaka from "./intercontinental-dhaka";
import bsmmu from "./bsmmu";
import cityCentreDhaka from "./city-centre-dhaka";
import nagarBhaban from "./nagar-bhaban";
import dhakaGpo from "./dhaka-gpo";
import baraKatra from "./bara-katra";
import chotoKatra from "./choto-katra";
import ruplalHouse from "./ruplal-house";
import northbrookHall from "./northbrook-hall";
import khanMohammadMridhaMosque from "./khan-mohammad-mridha-mosque";
import binatBibiMosque from "./binat-bibi-mosque";
import shankhariBazar from "./shankhari-bazar";
import kakrailMosque from "./kakrail-mosque";
import mirpurIntellectualsMemorial from "./mirpur-intellectuals-memorial";
import shahAliMazar from "./shah-ali-mazar";
import ramnaKaliMandir from "./ramna-kali-mandir";
import stMarysCathedral from "./st-marys-cathedral";
import dharmarajikaMonastery from "./dharmarajika-monastery";
import gurdwaraNanakShahi from "./gurdwara-nanak-shahi";
import iccb from "./iccb";
import northSouthUniversity from "./north-south-university";
import bcfecPurbachal from "./bcfec-purbachal";
import evercareHospital from "./evercare-hospital";
import unitedHospital from "./united-hospital";

const entries = {
  "dhaka-gate": dhakaGate,
  "bangabhaban": bangabhaban,
  "old-high-court": oldHighCourt,
  "bangla-academy": banglaAcademy,
  "shilpakala-academy": shilpakalaAcademy,
  "dhaka-new-market": dhakaNewMarket,
  "nilkhet-book-market": nilkhetBookMarket,
  "intercontinental-dhaka": intercontinentalDhaka,
  "bsmmu": bsmmu,
  "city-centre-dhaka": cityCentreDhaka,
  "nagar-bhaban": nagarBhaban,
  "dhaka-gpo": dhakaGpo,
  "bara-katra": baraKatra,
  "choto-katra": chotoKatra,
  "ruplal-house": ruplalHouse,
  "northbrook-hall": northbrookHall,
  "khan-mohammad-mridha-mosque": khanMohammadMridhaMosque,
  "binat-bibi-mosque": binatBibiMosque,
  "shankhari-bazar": shankhariBazar,
  "kakrail-mosque": kakrailMosque,
  "mirpur-intellectuals-memorial": mirpurIntellectualsMemorial,
  "shah-ali-mazar": shahAliMazar,
  "ramna-kali-mandir": ramnaKaliMandir,
  "st-marys-cathedral": stMarysCathedral,
  "dharmarajika-monastery": dharmarajikaMonastery,
  "gurdwara-nanak-shahi": gurdwaraNanakShahi,
  "iccb": iccb,
  "north-south-university": northSouthUniversity,
  "bcfec-purbachal": bcfecPurbachal,
  "evercare-hospital": evercareHospital,
  "united-hospital": unitedHospital,
} satisfies Record<string, LandmarkModule | null>;

/** Every registry key, built or not: the landmark kinds modules may use. */
export type LandmarkModuleKey = keyof typeof entries;

/** The built landmarks, in registry order. */
export const LANDMARK_MODULES: Array<LandmarkModule & { key: LandmarkModuleKey }> = [];
for (const [key, module] of Object.entries(entries) as Array<[LandmarkModuleKey, LandmarkModule | null]>) {
  if (!module) continue;
  if (module.key !== key) {
    console.error(`Landmark module app/landmarks/${key}.ts has key "${module.key}"; it must be "${key}". Skipped.`);
    continue;
  }
  LANDMARK_MODULES.push({ ...module, key });
}
