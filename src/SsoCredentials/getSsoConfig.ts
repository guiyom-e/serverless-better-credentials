import AWSUtil from 'aws-sdk/lib/util';
import { ConfigData, SsoIniLoader, SsoProfileConfig } from '../types';

const configOptInEnv = 'AWS_SDK_LOAD_CONFIG';
const sharedConfigFileEnv = 'AWS_CONFIG_FILE';
const sharedCredentialsFileEnv = 'AWS_SHARED_CREDENTIALS_FILE';

function isSsoProfileConfig(c: unknown): c is SsoProfileConfig {
  if (c === undefined || c === null) return false;
  if (typeof c !== 'object') return false;
  if (
    !(
      'sso_account_id' in c
      && 'sso_region' in c
      && 'sso_role_name' in c
      && 'sso_start_url' in c
    )
  ) return false;
  if (typeof (c as SsoProfileConfig).sso_account_id !== 'string') return false;
  if (typeof (c as SsoProfileConfig).sso_region !== 'string') return false;
  if (typeof (c as SsoProfileConfig).sso_role_name !== 'string') return false;
  if (typeof (c as SsoProfileConfig).sso_start_url !== 'string') return false;
  return true;
}

const getProfilesFromCredentialsFile = (iniLoader: SsoIniLoader): ConfigData => {
  const filename = process.env[configOptInEnv];

  const config = iniLoader.loadFrom({
    isConfig: true,
    filename,
  });

  return {
    config,
    keys: Object.keys(config),
    values: Object.values(config),
  };
};

const getProfilesFromConfigFile = (
  iniLoader: SsoIniLoader,
  filename: string | undefined,
): ConfigData => {
  const configFilename = filename
    || (process.env[configOptInEnv] && process.env[sharedCredentialsFileEnv]);
  const config = iniLoader.loadFrom({
    filename: configFilename,
  });

  return {
    config,
    keys: Object.keys(config),
    values: Object.values(config),
  };
};

const fillProfilesFromConfiguration = (
  configuration: ConfigData,
  profiles: Record<string, SsoProfileConfig>,
): Record<string, SsoProfileConfig> => {
  const { values, keys } = configuration;
  const newProfiles = profiles;

  if (values && keys) {
    keys.forEach((profileName, index) => {
      const foundProfile: Record<string, string> = values[index];
      newProfiles[profileName] = {
        ...profiles[profileName],
        ...foundProfile,
      };
    });
  }

  return newProfiles;
};

const getSsoSessions = (
  iniLoader: SsoIniLoader,
  filename: string | undefined,
) => {
  const filenameForSessions = filename
    || (process.env[sharedConfigFileEnv] && process.env[sharedCredentialsFileEnv]);
  const config = iniLoader.loadSsoSessionsFrom({
    filename: filenameForSessions,
  });

  return {
    config,
    keys: Object.keys(config),
    values: Object.values(config),
  };
};

const addSsoDataToProfiles = (
  sessionConfiguration: ConfigData,
  profiles: Record<string, SsoProfileConfig>,
) => {
  const profileNames = Object.keys(profiles);
  const profilesWithSessionData = profiles;

  profileNames.forEach((profileName) => {
    sessionConfiguration.keys.forEach((ssoSessionName) => {
      if (ssoSessionName === profiles[profileName].sso_session) {
        const session = sessionConfiguration.config[ssoSessionName];
        profilesWithSessionData[profileName] = {
          ...profiles[profileName],
          sso_start_url: session.sso_start_url,
        };
      }
    });
  });

  return profilesWithSessionData;
};

const getProfilesFromSsoConfig = (
  iniLoader: SsoIniLoader,
  filename?: string,
) => {
  const configurations: {
    profilesFromConfig: ConfigData;
    profilesFromCredentials: ConfigData;
    ssoSessions: ConfigData;
  } = {
    profilesFromConfig: getProfilesFromCredentialsFile(iniLoader),
    profilesFromCredentials: getProfilesFromConfigFile(iniLoader, filename),
    ssoSessions: getSsoSessions(iniLoader, filename),
  };

  const profilesFromConfig = fillProfilesFromConfiguration(
    configurations.profilesFromConfig,
    {},
  );
  const allProfiles: Record<string, SsoProfileConfig> = fillProfilesFromConfiguration(
    configurations.profilesFromCredentials,
    profilesFromConfig,
  );

  const profilesWithSsoData = addSsoDataToProfiles(
    configurations.ssoSessions,
    allProfiles,
  );

  return profilesWithSsoData;
};

export default function getSsoConfig(options: {
  filename?: string;
  profile?: string;
}): SsoProfileConfig {
  if (!options.profile) {
    throw new Error('Cannot load SSO credentials without a profile');
  }
  const profiles = getProfilesFromSsoConfig(
    // https://github.com/aws/aws-sdk-js/pull/4456
    AWSUtil.iniLoader as unknown as SsoIniLoader,
    options.filename,
  );
  const config = profiles[options.profile];
  if (!isSsoProfileConfig(config)) {
    throw new Error(
      `Profile ${options.profile} does not have valid SSO credentials. Required `
      + 'parameters "sso_account_id", "sso_region", "sso_role_name", '
      + '"sso_start_url". Reference: '
      + 'https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html',
    );
  }
  return config;
}
