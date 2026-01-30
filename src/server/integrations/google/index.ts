export * from './provider';
export * from './client';
export * from './watch-manager';
export * from './mail';
export * from './message';
export * from './thread';
export * from './label';
export * from './draft';
export * from './history';
export * from './attachment';

export {
    extractEmailAddress,
    extractDomainFromEmail,
    extractNameFromEmail,
    getSearchTermForSender,
} from '@/server/utils/email';

