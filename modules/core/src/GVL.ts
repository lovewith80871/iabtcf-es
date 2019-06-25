import {Json} from './Json';
import {GVLError} from './errors/GVLError';

import {
  GVLBase,
  GVLMap,
  Purpose,
  Feature,
  Vendor,
  Stack,
} from './model/GVLBase';

import {
  ByPurposeVendorMap,
  BySpecialPurposeVendorMap,
  ByFeatureVendorMap,
  BySpecialFeatureVendorMap,
} from './model/GVLMaps';

/**
 * TODO: make map to cache language translations under language so if a
 * language is loaded twice it won't go and get it more than once
 */

import {VendorList} from './model/VendorList';

export type VersionOrObject = string | number | object;
type PurposeOrFeature = 'purpose' | 'feature';
type PurposeSubType = 'consent' | 'legInt' | 'flexible';

/**
 * class with utilities for managing the global vendor list.  Will use JSON to
 * fetch the vendor list from specified url and will serialize it into this
 * object and provide accessors.  Provides ways to group vendors on the list by
 * purpose and feature.
 */
class GVL {

  /**
   * @static
   * @param {string} - the base url to load the vendor-list.json from.  This is
   * broken out from the filename because it follows a different scheme for
   * latest file vs versioned files.
   */
  public static baseUrl: string;

  /**
   * @static
   * @param {string} - the latest is assumed to be vendor-list.json because
   * that is what the iab uses, but it could be different... if you want
   */
  public static latestFilename: string = 'vendor-list.json';


  /**
   * @static
   * @param {string} - the versioned name is assumed to be
   * vendor-list-v[VERSION].json where [VERSION] will be replaced with the
   * specified version.  But it could be different... if you want just make
   * sure to include the [VERSION] macro if you have a numbering scheme, it's a
   * simple string substitution.
   *
   * eg.
   * ```javascript
   * GVL.baseUrl = "http://www.mydomain.com/iabcmp/";
   * GVL.versionedFilename = "vendorlist?getVersion=[VERSION]";
   * ```
   */
  public static versionedFilename: string = 'archives/vendor-list-v[VERSION].json';

  /**
   * @param {string} - Translations of the names and descriptions for Purposes,
   * Special Purposes, Features, and Special Features to non-English languages
   * are contained in a file where attributes containing English content
   * (except vendor declaration information) are translated.  The iab publishes
   * one following the scheme below where the LANG is the iso639-1 language
   * code.  For a list of available translations
   * [please go here](https://register.consensu.org/Translation).
   *
   * eg.
   * ```javascript
   * GVL.baseUrl = "http://www.mydomain.com/iabcmp/";
   * GVL.langTranslationFilename = "purposes?getPurposes=[LANG]";
   * ```
   */
  public static langTranslationFilename: string = 'purposes-[LANG].json';

  /**
   * @param {Promise} resolved when this GVL object is populated with the data
   * or rejected if there is an error
   */
  public readyPromise: Promise<void | GVLError>;

  /**
   * @param {number} gvlSpecificationVersion - schema version for the GVL that is used
   */
  public gvlSpecificationVersion: number;

  /**
   * @param {number} incremented with each published file change
   */
  public vendorListVersion: number;

  /**
   * @param {number} tcfPolicyVersion - The TCF MO will increment this value
   * whenever a GVL change (such as adding a new Purpose or Feature or a change
   * in Purpose wording) legally invalidates existing TC Strings and requires
   * CMPs to re-establish transparency and consent from users. If the policy
   * version number in the latest GVL is different from the value in your TC
   * String, then you need to re-establish transparency and consent for that
   * user. A version 1 format TC String is considered to have a version value
   * of 1.
   */
  public tcfPolicyVersion: number;

  /**
   * @param {string | Date} lastUpdated - the date in which the vendor list
   * json file  was last updated.
   */
  public lastUpdated: string | Date;

  /**
   * @param {GVLMap<Purpose>} a collection of [[Purpose]]s
   */
  public purposes: GVLMap<Purpose>;

  /**
   * @param {GVLMap<Purpose>} a collection of [[Purpose]]s
   */
  public specialPurposes: GVLMap<Purpose>;

  /**
   * @param {GVLMap<Feature>} a collection of [[Feature]]s
   */
  public features: GVLMap<Feature>;

  /**
   * @param {GVLMap<Feature>} a collection of [[Feature]]s
   */
  public specialFeatures: GVLMap<Feature>;

  /**
   * @param {GVLMap<Vendor>} a collection of [[Vendor]]s
   */
  private vendors_: GVLMap<Vendor>;

  /**
   * @param {GVLMap<Vendor>} a collection of [[Vendor]]. Used as a backup if a whitelist is sets
   */
  private fullVendorList: GVLMap<Vendor>;

  /**
   * @param {ByPurposeVendorMap} vendors by purpose
   */
  private byPurposeVendorMap: ByPurposeVendorMap;

  /**
   * @param {BySpecialPurposeVendorMap} vendors by special purpose
   */
  private bySpecialPurposeVendorMap: BySpecialPurposeVendorMap;

  /**
   * @param {ByFeatureVendorMap} vendors by feature
   */
  private byFeatureVendorMap: ByFeatureVendorMap;

  /**
   * @param {BySpecialFeatureVendorMap} vendors by special feature
   */
  private bySpecialFeatureVendorMap: BySpecialFeatureVendorMap;

  /**
   * @param {GVLMap<Stack>} a collection of [[Stack]]s
   */
  public stacks: GVLMap<Stack>;

  private readonly DEFAULT_LANGUAGE: string = 'en';

  private lang_: string;


  /**
   * @param {VersionOrObject} [versionOrObject] - can be either the
   * Json object that is the GVL or a version number represented as a string or
   * number to download.  If nothing is passed the latest version of the GVL
   * will be loaded
   */
  public constructor( versionOrObject?: VersionOrObject ) {

    // should have been configured before and instance was created and will persist through the app
    let url = GVL.baseUrl;

    this.lang_ = this.DEFAULT_LANGUAGE;

    if (typeof versionOrObject === 'object') {

      this.deserialize(versionOrObject as VendorList);
      this.readyPromise = new Promise((resolve: Function): void => {

        resolve();

      });

    } else {

      if (!url) {

        throw new GVLError('must specify GVL.baseUrl before loading GVL json');

      }

      url += this.addTrailingSlashMaybe(url);

      if (versionOrObject as number > 0) {

        // load version specified
        url += GVL.versionedFilename.replace('[VERSION]', versionOrObject + '');
        this.getJson(url);

      } else {

        // whatever it is (or isn't)... it doesn't matter we'll just get the latest
        url += GVL.latestFilename;
        this.getJson(url);

      }

    }

  }
  private addTrailingSlashMaybe(url: string): string {

    // if a trailing slash was forgotten
    if (url[url.length - 1] !== '/') {

      url += '/';

    }
    return url;

  }

  private getJson(url: string): void {

    this.readyPromise = new Promise((resolve: Function, reject: Function): void => {

      Json.fetch(url).then((response: object): void => {

        this.deserialize(response as VendorList);
        resolve();

      })
        .catch((err: Error): void => {

          reject(new GVLError(err.message));

        });

    });

  }

  /**
   * changeLanguage - retrieves the purpose language translation and sets the
   * internal language variable
   *
   * @param {string} lang - ISO 639-1 langauge code to change language to
   * @return {Promise<void | GVLError>} - returns the `readyPromise` and
   * resolves when this GVL is populated with the data from the language file.
   */
  public changeLanguage(lang: string): Promise<void | GVLError> {

    if (/^([A-z]){2}$/.test(lang)) {

      if (lang !== this.lang_) {

        let url = GVL.baseUrl;

        if (!url) {

          throw new GVLError('must specify GVL.baseUrl before changing the language');

        }

        url += this.addTrailingSlashMaybe(url);

        // load version specified
        url += GVL.langTranslationFilename.replace('[LANG]', lang);
        this.getJson(url);

      } else {

        // didn't actually have to change anything...
        this.readyPromise = new Promise((resolve: Function): void => {

          resolve();

        });

      }
      this.lang_ = lang;

      return this.readyPromise;

    } else {

      throw new GVLError('invalid language');

    }

  }
  public get language(): string {

    return this.lang_;

  }
  private isVendorList(gvlObject: GVLBase): gvlObject is VendorList {

    return (gvlObject as VendorList).vendors !== undefined;

  }

  private deserialize(gvlObject: GVLBase): void {

    this.gvlSpecificationVersion = gvlObject.gvlSpecificationVersion;
    this.vendorListVersion = gvlObject.vendorListVersion;
    this.tcfPolicyVersion = gvlObject.tcfPolicyVersion;
    this.lastUpdated = gvlObject.lastUpdated;
    if (typeof this.lastUpdated === 'string') {

      this.lastUpdated = new Date(this.lastUpdated);

    }
    this.purposes = gvlObject.purposes;
    this.specialPurposes = gvlObject.specialPurposes;
    this.features = gvlObject.features;
    this.specialFeatures = gvlObject.specialFeatures;
    this.stacks = gvlObject.stacks;

    if (this.isVendorList(gvlObject)) {

      this.vendors_ = gvlObject.vendors;
      this.fullVendorList = gvlObject.vendors;
      this.mapVendors();

    }

  }

  private mapVendors(): void {

    // create new instances of the maps
    this.byPurposeVendorMap = {};
    this.byFeatureVendorMap = {};
    this.bySpecialFeatureVendorMap = {};

    // initializes data structure for purpose map
    Object.keys(this.purposes).forEach((purposeId: string): void => {

      this.byPurposeVendorMap[purposeId] = {
        legInt: new Set<number>(),
        consent: new Set<number>(),
        flexible: new Set<number>(),
      };

    });

    // initializes data structure for special purpose map
    Object.keys(this.specialPurposes).forEach((purposeId: string): void => {

      this.bySpecialPurposeVendorMap[purposeId] = new Set<number>();

    });

    // initializes data structure for feature map
    Object.keys(this.features).forEach((featureId: string): void => {

      this.byFeatureVendorMap[featureId] = new Set<number>();

    });

    // initializes data structure for feature map
    Object.keys(this.specialFeatures).forEach((featureId: string): void => {

      this.bySpecialFeatureVendorMap[featureId] = new Set<number>();

    });

    // assigns vendor ids to their respective maps
    Object.keys(this.vendors_).forEach((vendorId: string): void => {

      const vendor: Vendor = this.vendors_[vendorId];
      const numVendorId: number = parseInt(vendorId, 10);

      vendor.purposeIds.forEach((purposeId: number): void => {

        const purpGroup = this.byPurposeVendorMap[purposeId + ''];

        purpGroup.consent.add(numVendorId);

      });

      vendor.legIntPurposeIds.forEach((purposeId: number): void => {

        this.byPurposeVendorMap[purposeId + ''].legInt.add(numVendorId);

      });

      // could not be there
      if (vendor.flexiblePurposeIds) {

        vendor.flexiblePurposeIds.forEach((purposeId: number): void => {

          this.byPurposeVendorMap[purposeId + ''].flexible.add(numVendorId);

        });

      }

      vendor.featureIds.forEach((featureId: number): void => {

        this.byFeatureVendorMap[featureId + ''].add(numVendorId);

      });

      vendor.specialFeatureIds.forEach((featureId: number): void => {

        this.bySpecialFeatureVendorMap[featureId + ''].add(numVendorId);

      });

    });

  }

  private getFilteredVendors(purposeOrFeature: PurposeOrFeature, id: number, subType?: PurposeSubType): GVLMap<Vendor> {

    const properPurposeOrFeature: string = purposeOrFeature.charAt(0).toUpperCase() + purposeOrFeature.slice(1);
    let vendorSet: Set<number>;
    const retr: GVLMap<Vendor> = {};

    if (purposeOrFeature === 'purpose' && subType) {

      vendorSet = this['by' + properPurposeOrFeature + 'VendorMap'][id + ''][subType];

    } else {

      vendorSet = this['by' + properPurposeOrFeature + 'VendorMap'][id + ''];

    }

    vendorSet.forEach((vendorId: number): void => {

      retr[vendorId + ''] = this.vendors[vendorId + ''];

    });

    return retr;

  }

  /**
   * getVendorsWithConsentPurpose
   *
   * @param {number} purposeId
   * @return {GVLMap<Vendor>} - list of vendors that have declared the consent purpose id
   */
  public getVendorsWithConsentPurpose(purposeId: number): GVLMap<Vendor> {

    return this.getFilteredVendors('purpose', purposeId, 'consent');

  }

  /**
   * getVendorsWithLegIntPurpose
   *
   * @param {number} purposeId
   * @return {GVLMap<Vendor>} - list of vendors that have declared the legInt (Legitimate Interest) purpose id
   */
  public getVendorsWithLegIntPurpose(purposeId: number): GVLMap<Vendor> {

    return this.getFilteredVendors('purpose', purposeId, 'legInt');

  }

  /**
   * getVendorsWithFlexiblePurpose
   *
   * @param {number} purposeId
   * @return {GVLMap<Vendor>} - list of vendors that have declared the flexible purpose id
   */
  public getVendorsWithFlexiblePurpose(purposeId: number): GVLMap<Vendor> {

    return this.getFilteredVendors('purpose', purposeId, 'flexible');

  }

  /**
   * getVendorsWithSpecialPurpose
   *
   * @param {number} specialPurposeId
   * @return {GVLMap<Vendor>} - list of vendors that have declared the special purpose id
   */
  public getVendorsWithSpecialPurpose(specialPurposeId: number): GVLMap<Vendor> {

    return this.getFilteredVendors('purpose', specialPurposeId, 'flexible');

  }

  /**
   * getVendorsWithFeature
   *
   * @param {number} featureId
   * @return {GVLMap<Vendor>} - list of vendors that have declared the feature id
   */
  public getVendorsWithFeature(featureId: number): GVLMap<Vendor> {

    return this.getFilteredVendors('feature', featureId);

  }

  /**
   * getVendorsWithSpecialFeature
   *
   * @param {number} specialFeatureId
   * @return {GVLMap<Vendor>} - list of vendors that have declared the special feature id
   */
  public getVendorsWithSpecialFeature(specialFeatureId: number): GVLMap<Vendor> {

    return this.getFilteredVendors('feature', specialFeatureId);

  }

  public get vendors(): GVLMap<Vendor> {

    return this.vendors_;

  }

  /**
   * narrowVendorsTo - narrows vendors represented in this GVL to the list of ids passed in
   *
   * @param {number[]} vendorIds - list of ids to narrow this GVL to
   * @return {void}
   */
  public narrowVendorsTo(vendorIds: number[]): void {

    this.vendors_ = {};
    vendorIds.forEach((id: number): void => {

      const strId = id + '';

      if (this.fullVendorList[strId]) {

        this.vendors[strId] = this.fullVendorList[strId];

      }

    });
    this.mapVendors();

  }


}

export {GVL};
