'use strict';

// Setting names
const STREAM_TYPE_SETTING = 'streamType';
const TASK_TRACKING_NAME_SETTING = 'taskTrackingName';
const TIMEOUT_AT_PERCENTAGE_OF_REMAINING_TIME_SETTING = 'timeoutAtPercentageOfRemainingTime';
const MAX_NUMBER_OF_ATTEMPTS_SETTING = 'maxNumberOfAttempts';

const EXTRACT_MESSAGE_FROM_RECORD_SETTING = 'extractMessageFromRecord';
const DISCARD_UNUSABLE_RECORDS_SETTING = 'discardUnusableRecords';
const DISCARD_REJECTED_MESSAGES_SETTING = 'discardRejectedMessages';
const RESUBMIT_INCOMPLETE_MESSAGES_SETTING = 'resubmitIncompleteMessages';

const DEAD_RECORD_QUEUE_NAME_SETTING = 'deadRecordQueueName';
const DEAD_MESSAGE_QUEUE_NAME_SETTING = 'deadMessageQueueName';

// Valid stream types
const KINESIS_STREAM_TYPE = "kinesis";
const DYNAMODB_STREAM_TYPE = "dynamodb";

// Defaults
const defaultStreamType = KINESIS_STREAM_TYPE;
const defaultTaskTrackingName = 'taskTracking';
const defaultTimeoutAtPercentageOfRemainingTime = 0.9;
const defaultMaxNumberOfAttempts = 10;

const defaultDeadRecordQueueName = 'DeadRecordQueue';
const defaultDeadMessageQueueName = 'DeadMessageQueue';

/**
 * Utilities for configuring stream processing, which configures and determines the processing behaviour of a stream
 * consumer.
 * @module aws-stream-consumer/stream-processing-config
 * @author Byron du Preez
 */
module.exports = {
  // Stream processing configuration - configures and determines the processing behaviour of a stream consumer
  isStreamProcessingConfigured: isStreamProcessingConfigured,

  configureStreamProcessing: configureStreamProcessing,
  configureDefaultStreamProcessing: configureDefaultStreamProcessing,
  validateStreamProcessingConfiguration: validateStreamProcessingConfiguration,
  getDefaultStreamProcessingSettings: getDefaultStreamProcessingSettings,

  // Accessors for stream processing settings and functions
  getStreamProcessingSetting: getStreamProcessingSetting,
  getStreamProcessingFunction: getStreamProcessingFunction,
  // Convenience accessors for specific stream processing settings
  getStreamType: getStreamType,
  isKinesisStreamType: isKinesisStreamType,
  isDynamoDBStreamType: isDynamoDBStreamType,
  getMaxNumberOfAttempts: getMaxNumberOfAttempts,
  // Convenience accessors for specific stream processing functions
  getExtractMessageFromRecordFunction: getExtractMessageFromRecordFunction,
  getDiscardUnusableRecordsFunction: getDiscardUnusableRecordsFunction,
  getDiscardRejectedMessagesFunction: getDiscardRejectedMessagesFunction,
  getResubmitIncompleteMessagesFunction: getResubmitIncompleteMessagesFunction,

  /**
   * Default implementations of the stream processing functions, which are NOT meant to be used directly and are ONLY
   * exposed to facilitate re-using some of these functions if needed in a customised stream processing configuration.
   */
  DEFAULTS: {
    // Default extractMessageFromRecord function
    extractJsonMessageFromKinesisRecord: extractJsonMessageFromKinesisRecord,

    // Default discardUnusableRecords function
    discardUnusableRecordsToDRQ: discardUnusableRecordsToDRQ,

    // Default discardRejectedMessages function
    discardRejectedMessagesToDMQ: discardRejectedMessagesToDMQ,

    // Default resubmitIncompleteMessages function
    resubmitIncompleteMessagesToKinesis: resubmitIncompleteMessagesToKinesis,
  },
  // Generic settings names
  STREAM_TYPE_SETTING: STREAM_TYPE_SETTING,
  TASK_TRACKING_NAME_SETTING: TASK_TRACKING_NAME_SETTING,
  TIMEOUT_AT_PERCENTAGE_OF_REMAINING_TIME_SETTING: TIMEOUT_AT_PERCENTAGE_OF_REMAINING_TIME_SETTING,
  MAX_NUMBER_OF_ATTEMPTS_SETTING: MAX_NUMBER_OF_ATTEMPTS_SETTING,

  // Generic functions settings names
  EXTRACT_MESSAGE_FROM_RECORD_SETTING: EXTRACT_MESSAGE_FROM_RECORD_SETTING,
  DISCARD_UNUSABLE_RECORDS_SETTING: DISCARD_UNUSABLE_RECORDS_SETTING,
  DISCARD_REJECTED_MESSAGES_SETTING: DISCARD_REJECTED_MESSAGES_SETTING,
  RESUBMIT_INCOMPLETE_MESSAGES_SETTING: RESUBMIT_INCOMPLETE_MESSAGES_SETTING,

  // Specialised settings names used by default processing function implementations
  DEAD_RECORD_QUEUE_NAME_SETTING: DEAD_RECORD_QUEUE_NAME_SETTING,
  DEAD_MESSAGE_QUEUE_NAME_SETTING: DEAD_MESSAGE_QUEUE_NAME_SETTING,

  // Valid stream types
  KINESIS_STREAM_TYPE: KINESIS_STREAM_TYPE,
  DYNAMODB_STREAM_TYPE: DYNAMODB_STREAM_TYPE
};

const regions = require('aws-core-utils/regions');
const stages = require('aws-core-utils/stages');
const streamEvents = require('aws-core-utils/stream-events');
const kinesisUtils = require('aws-core-utils/kinesis-utils');
const configureKinesis = kinesisUtils.configureKinesis;

const Strings = require('core-functions/strings');
//const isBlank = Strings.isBlank;
const isNotBlank = Strings.isNotBlank;
const trim = Strings.trim;
// const stringify = Strings.stringify;

const logging = require('logging-utils/logging-utils');

// =====================================================================================================================
// Stream processing configuration - configures and determines the processing behaviour of a stream consumer
// =====================================================================================================================

/**
 * Returns true if stream processing is already configured on the given context; false otherwise.
 * @param {Object} context - the context to check
 * @returns {boolean} true if configured; false otherwise
 */
function isStreamProcessingConfigured(context) {
  return context && typeof context.streamProcessing === 'object';
}

/**
 * Stream processing settings which configure and determine the processing behaviour of an AWS stream consumer.
 * @typedef {Object} StreamProcessingSettings
 * @property {string} streamType - the type of stream being processed - valid values are "kinesis" or "dynamodb"
 * @property {string} taskTrackingName - the name of the task tracking object property on each message, which has or
 * will be assigned two properties: a 'ones' object property; and an 'alls' object property. The 'ones' property is a
 * map of all of the processOne tasks (i.e. the tasks for processing a single message at a time) keyed by task name.
 * The 'alls' property is a map of all of the processAll tasks (i.e. the tasks for processing all of the messages that
 * were received in a batch from an AWS stream) keyed by task name
 * @property {number} timeoutAtPercentageOfRemainingTime - the percentage of the remaining time at which to timeout
 * processing (expressed as a number between 0.0 and 1.0, e.g. 0.9 would mean timeout at 90% of the remaining time)
 * @property {number} maxNumberOfAttempts - the maximum number of attempts on each of a message's tasks that are allowed
 * before discarding the message and routing it to the Dead Message Queue. Note that if a message has multiple tasks, it
 * will only be discarded when all of its tasks have reached this maximum
 * @property {Function} extractMessageFromRecord - a synchronous function that will be used to extract a message from a
 * given stream event record, which must accept a record and the given context as arguments and return the extracted
 * message or throw an exception if a message cannot be extracted from the record
 * @property {Function} discardUnusableRecords - a function that will be used to discard any unusable records and that must
 * accept an array of unusable records and the context and ideally return a promise
 * @property {Function} discardRejectedMessages - a function that will be used to discard any rejected messages and that
 * must accept an array of rejected messages and the context and ideally return a promise
 * @property {Function} resubmitIncompleteMessages - a function that will be used to resubmit any incomplete messages and
 * that must accept: an array of incomplete messages; the name of the stream to which to resubmit; and the context and
 * ideally return a promise
 * @property {string} deadRecordQueueName - the unqualified stream name of the Dead Record Queue to which to discard unusable records
 * @property {string} deadMessageQueueName - the unqualified stream name of the Dead Message Queue to which to discard rejected messages
 */

/**
 * Configures the given context with the given stream processing settings, but only if stream processing is not
 * already configured on the given context OR if forceConfiguration is true.
 *
 * @param {Object} context - the context onto which to configure the given stream processing settings
 * @param {StreamProcessingSettings} settings - the stream processing settings to use
 * @param {boolean|undefined} [forceConfiguration] - whether or not to force configuration of the given settings, which
 * will override any previously configured stream processing settings on the given context
 * @return {Object} the context object configured with stream processing (either existing or new)
 */
function configureStreamProcessing(context, settings, forceConfiguration) {

  // If forceConfiguration is false check if the given context already has stream processing configured on it
  // and, if so, do nothing more and simply return the context as is (to prevent overriding an earlier configuration)
  if (!forceConfiguration && isStreamProcessingConfigured(context)) {
    return context;
  }

  // Configure default logging from local config if not configured yet
  const config = require('./config.json');
  configureLoggingIfNotConfigured(context, config.logging);

  // Validate the given stream type
  // validateStreamType(settings.streamType);

  // Configure stream processing with the given settings
  context.streamProcessing = settings;

  // Validate the stream processing configuration
  validateStreamProcessingConfiguration(context);

  return context;
}

/**
 * Configures a default Kinesis instance on the given context's kinesis property using the given Kinesis constructor
 * options, if it is not already configured.
 * @param {Object} context
 * @param {Object} [kinesisOptions] - the optional Kinesis constructor options to use
 */
function configureKinesisIfNotConfigured(context, kinesisOptions) {
  if (!context.kinesis) {
    context.warn(`An AWS Kinesis instance has not been configured on context.kinesis yet - configuring an AWS Kinesis instance with default settings from aws-stream-consumer/config.json. Preferably configure this beforehand, using aws-core-utils/kinesis-utils#configureKinesis`);
    // Configure a default Kinesis instance on context.kinesis if not already configured, which is needed by 3 of the above functions
    kinesisUtils.configureKinesis(context, kinesisOptions);
  }
}

/**
 * Configures the given context with the default stream processing settings, but only if stream processing is NOT
 * already configured on the given context OR if forceConfiguration is true.
 *
 * Default stream processing assumes the following:
 * - The stream event record is a Kinesis record
 * - The message is a JSON object serialized in base 64 format within the Kinesis record's data property
 * - See {@linkcode streamProcessing#extractMessageFromKinesisRecord} for the default extractMessageFromRecord
 *   implementation
 *
 * This behaviour can be changed by providing an alternative extractMessageFromRecord function via
 * {@linkcode configureStreamProcessing}.
 *
 * @see {@linkcode configureStreamProcessing} for more information.
 *
 * @param {Object} context - the context onto which to configure the default stream processing settings
 * @param {boolean|undefined} forceConfiguration - whether or not to force configuration of the given settings, which
 * will override any previously configured stream processing settings on the given context
 * @return {Object} the context object configured with stream processing settings (either existing or defaults)
 */
function configureDefaultStreamProcessing(context, forceConfiguration) {
  // If forceConfiguration is false check if the given context already has stream processing configured on it
  // and, if so, do nothing more and simply return the context as is (to prevent overriding an earlier configuration)
  if (!forceConfiguration && isStreamProcessingConfigured(context)) {
    return context;
  }
  // Load local defaults for settings
  const config = require('./config.json');

  // Configure default logging from local config if not configured yet
  configureLoggingIfNotConfigured(context, config.logging);

  // Get the default stream processing settings from the local config file
  const defaultSettings = getDefaultStreamProcessingSettings(config.streamProcessingSettings);

  // Configure the context with the default stream processing settings defined above
  configureStreamProcessing(context, defaultSettings, forceConfiguration);

  // Configure a default Kinesis instance on context.kinesis if not already configured, which is needed by 3 of the
  // above functions
  configureKinesisIfNotConfigured(context, config.kinesisOptions);

  return context;
}

/**
 * Simply returns the default stream processing settings, preferring settings in the given config object (if any) or in
 * config.streamProcessingSettings (if any) over the static default settings.
 *
 * This function is used internally by {@linkcode configureDefaultStreamProcessing}, but could also be used in custom
 * configurations to get the default settings as a base and override with your customisations before calling
 * {@linkcode configureStreamProcessing}.
 *
 * @param {Object} [config] - an optional config object containing either stream processing settings or a streamProcessingSettings object
 * @param {Object} [config.streamProcessingSettings] - an optional streamProcessingSettings object on the given config
 * object containing stream processing settings
 * @returns {StreamProcessingSettings} a stream processing settings object
 */
function getDefaultStreamProcessingSettings(config) {
  if (config && config.streamProcessingSettings) {
    return getDefaultStreamProcessingSettings(config.streamProcessingSettings);
  }

  function select(config, propertyName, defaultValue) {
    const configuredValue = config ? config[propertyName] : undefined;
    return isNotBlank(configuredValue) ? trim(configuredValue) : defaultValue
  }

  // Defaults
  const streamType = select(config, 'streamType', defaultStreamType);
  const taskTrackingName = select(config, 'taskTrackingName', defaultTaskTrackingName);

  const timeoutAtPercentageOfRemainingTime = select(config, 'timeoutAtPercentageOfRemainingTime',
    defaultTimeoutAtPercentageOfRemainingTime);

  const maxNumberOfAttempts = select(config, 'maxNumberOfAttempts', defaultMaxNumberOfAttempts);

  // DRQ and DMQ stream names
  const deadRecordQueueName = select(config, 'deadRecordQueueName', defaultDeadRecordQueueName);
  const deadMessageQueueName = select(config, 'deadMessageQueueName', defaultDeadMessageQueueName);

  return {
    // generic settings
    streamType: streamType,
    taskTrackingName: taskTrackingName,
    timeoutAtPercentageOfRemainingTime: timeoutAtPercentageOfRemainingTime,
    maxNumberOfAttempts: maxNumberOfAttempts,
    // configurable processing functions
    extractMessageFromRecord: extractJsonMessageFromKinesisRecord,
    discardUnusableRecords: discardUnusableRecordsToDRQ,
    discardRejectedMessages: discardRejectedMessagesToDMQ,
    resubmitIncompleteMessages: resubmitIncompleteMessagesToKinesis,
    // specialised settings needed by default implementations
    deadRecordQueueName: deadRecordQueueName,
    deadMessageQueueName: deadMessageQueueName
  };
}

function configureLoggingIfNotConfigured(context, config) {
  if (!logging.isLoggingConfigured(context)) {
    logging.configureLoggingFromConfig(context, config);
    context.warn(`Logging was not configured yet - used default logging configuration from aws-stream-consumer/config.json`);
  }
}

// function validateStreamType(streamType) {
//   if (Strings.isBlank(streamType)) {
//     throw new Error(`Stream type is required - must be either "${KINESIS_STREAM_TYPE}" or "${DYNAMODB_STREAM_TYPE}"`);
//   } else {
//     const type = Strings.trim(streamType).toLowerCase();
//     if (type !== KINESIS_STREAM_TYPE && type !== DYNAMODB_STREAM_TYPE) {
//       throw new Error(`Unexpected stream type (${streamType}) - must be either "${KINESIS_STREAM_TYPE}" or "${DYNAMODB_STREAM_TYPE}"`);
//     }
//   }
// }

function validateStreamProcessingConfiguration(context) {
  if (!getExtractMessageFromRecordFunction(context)) {
    const errMsg = `FATAL - Cannot extract any messages from any stream event records without a valid, configured extractMessageFromRecord function. Fix your Lambda by configuring a valid streamProcessing.extractMessageFromRecord function on its context via configureStreamProcessing and redeploy ASAP, since this issue is blocking all of your stream's shards!`;
    (context.error ? context.error : console.error)(errMsg);
    throw new Error(errMsg);
  }

  if (!getDiscardUnusableRecordsFunction(context)) {
    const errMsg = `FATAL - Cannot discard any unusable stream event records without a valid, configured discardUnusableRecords function. Fix your Lambda by configuring a valid streamProcessing.discardUnusableRecords function on its context via configureStreamProcessing and redeploy ASAP, since this issue is blocking all of your stream's shards!`;
    (context.error ? context.error : console.error)(errMsg);
    throw new Error(errMsg);
  }

  if (!getDiscardRejectedMessagesFunction(context)) {
    const errMsg = `FATAL - Cannot discard any rejected messages without a valid, configured discardRejectedMessages function. Fix your Lambda by configuring a valid streamProcessing.discardRejectedMessages function on its context via configureStreamProcessing and redeploy ASAP, since this issue is blocking all of your stream's shards!`;
    (context.error ? context.error : console.error)(errMsg);
    throw new Error(errMsg);
  }

  if (!getResubmitIncompleteMessagesFunction(context)) {
    const errMsg = `FATAL - Cannot resubmit any incomplete messages without a valid, configured resubmitIncompleteMessages function. Fix your Lambda by configuring a valid streamProcessing.resubmitIncompleteMessages function on its context via configureStreamProcessing and redeploy ASAP, since this issue is blocking all of your stream's shards!`;
    (context.error ? context.error : console.error)(errMsg);
    throw new Error(errMsg);
  }
}

/**
 * Returns the value of the named stream processing setting (if any) on the given context.
 * @param context - the context from which to fetch the named setting's value
 * @param settingName - the name of the stream processing setting
 * @returns {*|undefined} the value of the named setting (if any); otherwise undefined
 */
function getStreamProcessingSetting(context, settingName) {
  return context && context.streamProcessing && isNotBlank(settingName) && context.streamProcessing[settingName] ?
    context.streamProcessing[settingName] : undefined;
}

/**
 * Returns the stream type configured on the given context.
 * @param context - the context from which to fetch the stream type
 * @returns {string|undefined} the stream type (if any); otherwise undefined
 */
function getStreamType(context) {
  return getStreamProcessingSetting(context, STREAM_TYPE_SETTING);
}

function isKinesisStreamType(context) {
  return getStreamType(context) === KINESIS_STREAM_TYPE;
}

function isDynamoDBStreamType(context) {
  return getStreamType(context) === DYNAMODB_STREAM_TYPE;
}

/**
 * Returns the maximum number of attempts configured on the given context.
 * @param context - the context from which to fetch the maximum number of attempts
 * @returns {number|undefined} the maximum number of attempts (if any); otherwise undefined
 */
function getMaxNumberOfAttempts(context) {
  return getStreamProcessingSetting(context, MAX_NUMBER_OF_ATTEMPTS_SETTING);
}

/**
 * Returns the function configured at the named stream processing setting on the given context (if any and if it's a
 * real function); otherwise returns undefined.
 * @param context - the context from which to fetch the function
 * @param settingName - the name of the stream processing setting
 * @returns {*|undefined} the named function (if it's a function); otherwise undefined
 */
function getStreamProcessingFunction(context, settingName) {
  const fn = getStreamProcessingSetting(context, settingName);
  return typeof fn === 'function' ? fn : undefined;
}

/**
 * Returns the extractMessageFromRecord function configured on the given context (if any and if it's a real function);
 * otherwise returns undefined.
 * @param context - the context from which to fetch the function
 * @returns {*|undefined} the extractMessageFromRecord function (if it's a function); otherwise undefined
 */
function getExtractMessageFromRecordFunction(context) {
  return getStreamProcessingFunction(context, EXTRACT_MESSAGE_FROM_RECORD_SETTING);
}

/**
 * A default extractMessageFromRecord function that attempts to extract and parse the original JSON message object from
 * the given Kinesis record and returns the message (if parsable) or throws an error (if not).
 *
 * @param {Object} record - a Kinesis stream event record
 * @param {Object} context - the context
 * @return {Object} the message object (if successfully extracted)
 * @throws {Error} an error if a message could not be successfully extracted from the given record
 */
function extractJsonMessageFromKinesisRecord(record, context) {
  // First convert the Kinesis record's kinesis.data field back from Base 64 to UTF-8
  const msgData = new Buffer(record.kinesis.data, 'base64').toString('utf-8');

  if (context.traceEnabled) context.trace(`Parsing Kinesis record data (${msgData})`);

  try {
    // Convert the decoded record data back into its original JSON message object form
    return JSON.parse(msgData);

  } catch (err) {
    context.error(`Failed to parse decoded Kinesis record data (${msgData}) back to a JSON message object`, err.stack);
    throw err;
  }
}

/**
 * Returns the discardUnusableRecords function configured on the given context (if any and if it's a real function);
 * otherwise returns undefined.
 * @param context - the context from which to fetch the function
 * @returns {*|undefined} the discardUnusableRecords function (if it's a function); otherwise undefined
 */
function getDiscardUnusableRecordsFunction(context) {
  return getStreamProcessingFunction(context, DISCARD_UNUSABLE_RECORDS_SETTING);
}

/**
 * Discards all the given unusable records to the DRQ (i.e. Dead Record Queue).
 * @param {Object[]} unusableRecords - the list of unusable records to discard
 * @param {Object} context - the context to use
 * @return {Promise} a promise that will complete when all of its discard unusable record promises complete
 */
function discardUnusableRecordsToDRQ(unusableRecords, context) {
  if (!unusableRecords || unusableRecords.length <= 0) {
    return Promise.resolve([]);
  }

  const kinesis = getKinesis(context);
  //const kinesisPutRecord = Promise.wrapMethod(kinesis, kinesis.putRecord);

  // Get the stage-qualified version of the DRQ stream name
  const unqualifiedDeadRecordQueueName = context.streamProcessing.deadRecordQueueName;
  const deadRecordQueueName = stages.toStageQualifiedStreamName(unqualifiedDeadRecordQueueName, context.stage, context);

  function sendRecordToDRQ(record) {
    const partitionKey = record.kinesis.partitionKey;
    const explicitHashKey = record.kinesis.explicitHashKey;
    const sequenceNumber = record.kinesis.sequenceNumber;

    // resubmit message to kinesis
    const request = {
      StreamName: deadRecordQueueName,
      PartitionKey: partitionKey,
      SequenceNumberForOrdering: sequenceNumber,
      Data: JSON.stringify(record)
    };
    if (explicitHashKey) {
      request.ExplicitHashKey = explicitHashKey;
    }
    return kinesis.putRecord(request).promise();
    //return kinesisPutRecord(request);
  }

  // Resubmit all of the rejected messages
  const promises = unusableRecords.map(record => sendRecordToDRQ(record));
  const m = unusableRecords.length;
  const plural = m !== 1 ? 's' : '';

  return Promise.all(promises)
    .then(results => {
      context.info(`Discarded ${m} unusable record${plural} to Kinesis DRQ (${deadRecordQueueName})`);
      return results;
    })
    .catch(err => {
      context.error(`Failed to discard ${m} unusable record${plural} to Kinesis DRQ (${deadRecordQueueName}) - error (${err})`, err.stack);
      throw err;
    });
}

/**
 * Returns the discardRejectedMessages function configured on the given context (if any and if it's a real function);
 * otherwise returns undefined.
 * @param context - the context from which to fetch the function
 * @returns {*|undefined} the discardRejectedMessages function (if it's a function); otherwise undefined
 */
function getDiscardRejectedMessagesFunction(context) {
  return getStreamProcessingFunction(context, DISCARD_REJECTED_MESSAGES_SETTING);
}

/**
 * Routes all the given rejected messages to the DMQ (i.e. Dead Message Queue).
 * @param {Array.<Object>} rejectedMessages the list of rejected messages to discard
 * @param {Object} context the context to use
 * @return {Promise}
 */
function discardRejectedMessagesToDMQ(rejectedMessages, context) {
  if (!rejectedMessages || rejectedMessages.length <= 0) {
    return Promise.resolve([]);
  }

  const kinesis = getKinesis(context);
  //const kinesisPutRecord = Promise.wrapMethod(kinesis, kinesis.putRecord);

  // Get the stage-qualified version of the DRQ stream name
  const unqualifiedDeadMessageQueueName = context.streamProcessing.deadMessageQueueName;
  const deadMessageQueueName = stages.toStageQualifiedStreamName(unqualifiedDeadMessageQueueName, context.stage, context);

  function sendMessageToDMQ(message) {
    // Get the original record's key information
    const origRecord = getRecord(message, context);
    const partitionKey = origRecord.kinesis.partitionKey;
    const explicitHashKey = origRecord.kinesis.explicitHashKey;
    const sequenceNumber = origRecord.kinesis.sequenceNumber;

    // Get the original record's event source stream name
    const eventSourceStreamName = streamEvents.getEventSourceStreamName(origRecord);
    const sourceStreamName = eventSourceStreamName ? eventSourceStreamName :
      context.streamConsumer ? context.streamConsumer.resubmitStreamName : '';

    // Wrap the message in a rejected message "envelope" with metadata
    const rejectedMessage = {
      streamName: sourceStreamName,
      message: message,
      partitionKey: partitionKey,
      sequenceNumber: sequenceNumber,
      discardedAt: new Date().toISOString()
    };
    if (explicitHashKey) {
      rejectedMessage.explicitHashKey = explicitHashKey;
    }

    // discard message to DMQ
    const request = {
      StreamName: deadMessageQueueName,
      PartitionKey: partitionKey,
      SequenceNumberForOrdering: sequenceNumber,
      Data: JSON.stringify(rejectedMessage)
    };
    if (explicitHashKey) {
      request.ExplicitHashKey = explicitHashKey;
    }
    return kinesis.putRecord(request).promise();
    //return kinesisPutRecord(request);
  }

  // Resubmit all of the rejected messages
  const promises = rejectedMessages.map(message => sendMessageToDMQ(message));
  const m = rejectedMessages.length;
  const plural = m !== 1 ? 's' : '';

  return Promise.all(promises)
    .then(results => {
      context.info(`Discarded ${m} rejected message${plural} to Kinesis DMQ (${deadMessageQueueName})`);
      return results;
    })
    .catch(err => {
      context.error(`Failed to discard ${m} rejected message${plural} to Kinesis DMQ (${deadMessageQueueName}) - error (${err})`, err.stack);
      throw err;
    });
}

/**
 * Returns the resubmitIncompleteMessages function configured on the given context (if any and if it's a real function);
 * otherwise returns undefined.
 * @param context - the context from which to fetch the function
 * @returns {*|undefined} the resubmitIncompleteMessages function (if it's a function); otherwise undefined
 */
function getResubmitIncompleteMessagesFunction(context) {
  return getStreamProcessingFunction(context, RESUBMIT_INCOMPLETE_MESSAGES_SETTING);
}

/**
 * A default resubmitIncompleteMessages function that attempts to resubmit all of the given incomplete messages back to
 * the named Kinesis stream, which typically should be the source stream from which the messages were received.
 * @param {Object[]} incompleteMessages - the incomplete messages to be resubmitted
 * @param {string} streamName - the named of stream to which to resubmit the messages
 * @param {Object} context - the context
 * @returns {Promise} a promise that will complete when all of the resubmit incomplete message promises have completed
 */
function resubmitIncompleteMessagesToKinesis(incompleteMessages, streamName, context) {
  if (!incompleteMessages || incompleteMessages.length <= 0) {
    return Promise.resolve([]);
  }
  const kinesis = getKinesis(context);
  //const kinesisPutRecord = Promise.wrapMethod(kinesis, kinesis.putRecord);

  function resubmitMessage(message) {
    const origRecord = getRecord(message, context);
    const partitionKey = origRecord.kinesis.partitionKey;
    const explicitHashKey = origRecord.kinesis.explicitHashKey;
    const sequenceNumber = origRecord.kinesis.sequenceNumber;

    // resubmit message to kinesis
    const request = {
      StreamName: streamName,
      PartitionKey: partitionKey,
      SequenceNumberForOrdering: sequenceNumber,
      Data: JSON.stringify(message)
    };
    if (explicitHashKey) {
      request.ExplicitHashKey = explicitHashKey;
    }
    return kinesis.putRecord(request).promise();
    //return kinesisPutRecord(request);
  }

  // Resubmit all of the incomplete messages
  const promises = incompleteMessages.map(message => resubmitMessage(message));
  const m = incompleteMessages.length;
  const plural = m !== 1 ? 's' : '';

  return Promise.all(promises)
    .then(results => {
      context.info(`Resubmitted ${m} incomplete message${plural} back to Kinesis stream (${streamName})`);
      return results;
    })
    .catch(err => {
      context.error(`Failed to resubmit ${m} incomplete message${plural} back to Kinesis stream (${streamName}) - error (${err})`, err.stack);
      throw err;
    });
}

function getKinesis(context) {
  if (!context.kinesis) {
    context.warn(`context.kinesis was not configured - using default kinesis configuration`);
    configureKinesis(context, 0);
  }
  return context.kinesis;
}

function getRecord(message, context) {
  const taskTrackingName = context.streamProcessing.taskTrackingName;
  const taskTracking = message[taskTrackingName];
  return taskTracking ? taskTracking.record : undefined;
}