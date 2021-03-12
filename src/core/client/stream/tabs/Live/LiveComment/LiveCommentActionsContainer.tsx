import React, { FunctionComponent, useCallback, useMemo } from "react";
import Responsive from "react-responsive";
import { graphql } from "relay-runtime";

import { getModerationLink } from "coral-framework/helpers";
import { useLocal, withFragmentContainer } from "coral-framework/lib/relay";
import { GQLUSER_STATUS } from "coral-framework/schema";
import { Ability, can } from "coral-stream/permissions";
import { ReactionButtonContainer } from "coral-stream/tabs/shared/ReactionButton";
import { ReportButton } from "coral-stream/tabs/shared/ReportFlow";
import { Flex, Icon } from "coral-ui/components/v2";
import { Button } from "coral-ui/components/v3";

import { LiveCommentActionsContainer_comment } from "coral-stream/__generated__/LiveCommentActionsContainer_comment.graphql";
import { LiveCommentActionsContainer_local } from "coral-stream/__generated__/LiveCommentActionsContainer_local.graphql";
import { LiveCommentActionsContainer_settings } from "coral-stream/__generated__/LiveCommentActionsContainer_settings.graphql";
import { LiveCommentActionsContainer_story } from "coral-stream/__generated__/LiveCommentActionsContainer_story.graphql";
import { LiveCommentActionsContainer_viewer } from "coral-stream/__generated__/LiveCommentActionsContainer_viewer.graphql";

import ShortcutIcon from "../ShortcutIcon";

import styles from "./LiveCommentActionsContainer.css";

interface Props {
  story: LiveCommentActionsContainer_story;
  comment: LiveCommentActionsContainer_comment;
  viewer: LiveCommentActionsContainer_viewer | null;
  settings: LiveCommentActionsContainer_settings;

  onConversation?: (comment: LiveCommentActionsContainer_comment) => void;
  onReply?: (comment: LiveCommentActionsContainer_comment) => void;
  showReport?: boolean;
  onToggleReport?: () => void;
}

const LiveCommentActionsContainer: FunctionComponent<Props> = ({
  story,
  comment,
  viewer,
  settings,
  onConversation,
  onReply,
  showReport,
  onToggleReport,
}) => {
  const isViewerBanned = !!viewer?.status.current.includes(
    GQLUSER_STATUS.BANNED
  );
  const isViewerSuspended = !!viewer?.status.current.includes(
    GQLUSER_STATUS.SUSPENDED
  );
  const isViewerWarned = !!viewer?.status.current.includes(
    GQLUSER_STATUS.WARNED
  );

  const [{ accessToken }] = useLocal<LiveCommentActionsContainer_local>(graphql`
    fragment LiveCommentActionsContainer_local on Local {
      accessToken
    }
  `);

  const showModerationCaret: boolean =
    !!viewer && story.canModerate && can(viewer, Ability.MODERATE);

  const moderationLinkSuffix =
    !!accessToken &&
    settings.auth.integrations.sso.enabled &&
    settings.auth.integrations.sso.targetFilter.admin &&
    `#accessToken=${accessToken}`;

  const gotoModerateCommentHref = useMemo(() => {
    let link = getModerationLink({ commentID: comment.id });
    if (moderationLinkSuffix) {
      link += moderationLinkSuffix;
    }

    return link;
  }, [comment.id, moderationLinkSuffix]);

  const handleOnConversation = useCallback(() => {
    if (!onConversation) {
      return;
    }

    onConversation(comment);
  }, [comment, onConversation]);

  const handleOnReply = useCallback(() => {
    if (!onReply) {
      return;
    }

    onReply(comment);
  }, [comment, onReply]);

  return (
    <Flex
      justifyContent="flex-start"
      alignItems="center"
      className={styles.actionBar}
    >
      <div className={styles.leftActions}>
        {viewer && (
          <ReactionButtonContainer
            reactedClassName=""
            comment={comment}
            settings={settings}
            viewer={viewer}
            readOnly={isViewerBanned || isViewerSuspended || isViewerWarned}
            isQA={false}
            isChat
          />
        )}
        <Button
          className={styles.replyButton}
          variant="none"
          onClick={handleOnReply}
        >
          <Flex justifyContent="flex-start" alignItems="center">
            <ShortcutIcon
              width="16px"
              height="16px"
              className={styles.replyIcon}
              ariaLabel="Reply"
            />
            <Responsive minWidth={400}>
              <span>Reply</span>
            </Responsive>
          </Flex>
        </Button>
        {comment.replyCount > 0 && onConversation && (
          <Button
            className={styles.conversationButton}
            variant="none"
            onClick={handleOnConversation}
            paddingSize="extraSmall"
          >
            <Flex justifyContent="flex-start" alignItems="center">
              <Icon
                className={styles.conversationIcon}
                aria-label="Read conversation"
              >
                forum
              </Icon>
              <Responsive minWidth={400}>
                <span>Read Conversation</span>
              </Responsive>
            </Flex>
          </Button>
        )}
      </div>

      <Flex className={styles.rightActions} justifyContent="flex-end">
        {viewer &&
          !isViewerBanned &&
          !isViewerSuspended &&
          !isViewerWarned &&
          !showModerationCaret &&
          onToggleReport && (
            <ReportButton
              onClick={onToggleReport}
              open={showReport}
              viewer={viewer}
              comment={comment}
            />
          )}
        {showModerationCaret && (
          <Button
            href={gotoModerateCommentHref}
            target="_blank"
            variant="flat"
            fontSize="small"
            paddingSize="extraSmall"
          >
            Moderate
          </Button>
        )}
      </Flex>
    </Flex>
  );
};

const enhanced = withFragmentContainer<Props>({
  story: graphql`
    fragment LiveCommentActionsContainer_story on Story {
      canModerate
    }
  `,
  viewer: graphql`
    fragment LiveCommentActionsContainer_viewer on User {
      role
      status {
        current
      }
      ...ReportFlowContainer_viewer
      ...ReportButton_viewer
      ...ReactionButtonContainer_viewer
    }
  `,
  comment: graphql`
    fragment LiveCommentActionsContainer_comment on Comment {
      id
      parent {
        id
      }
      replyCount
      ...ReportButton_comment
      ...ReportFlowContainer_comment
      ...ReactionButtonContainer_comment
      ...LiveCommentConversationContainer_comment
    }
  `,
  settings: graphql`
    fragment LiveCommentActionsContainer_settings on Settings {
      ...ReportFlowContainer_settings
      ...ReactionButtonContainer_settings
      auth {
        integrations {
          sso {
            enabled
            targetFilter {
              admin
            }
          }
        }
      }
    }
  `,
})(LiveCommentActionsContainer);

export default enhanced;