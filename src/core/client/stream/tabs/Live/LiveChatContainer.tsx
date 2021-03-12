import { Localized } from "@fluent/react/compat";
import React, {
  FunctionComponent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { graphql } from "react-relay";

import { useEffectAfterMount, useEffectAtUnmount } from "coral-framework/hooks";
import { useCoralContext } from "coral-framework/lib/bootstrap";
import { IntersectionProvider } from "coral-framework/lib/intersection";
import {
  useLocal,
  useSubscription,
  withFragmentContainer,
} from "coral-framework/lib/relay";
import { GQLCOMMENT_SORT, GQLUSER_STATUS } from "coral-framework/schema";
import { PropTypesOf } from "coral-framework/types";
import {
  LiveChatLoadBeforeEvent,
  LiveChatOpenConversationEvent,
  LiveJumpToCommentEvent,
} from "coral-stream/events";
import { Flex, Icon } from "coral-ui/components/v2";
import { Button, CallOut } from "coral-ui/components/v3";

import { LiveChatContainer_settings } from "coral-stream/__generated__/LiveChatContainer_settings.graphql";
import { LiveChatContainer_story } from "coral-stream/__generated__/LiveChatContainer_story.graphql";
import { LiveChatContainer_viewer } from "coral-stream/__generated__/LiveChatContainer_viewer.graphql";
import { LiveChatContainerAfterCommentEdge } from "coral-stream/__generated__/LiveChatContainerAfterCommentEdge.graphql";
import { LiveChatContainerBeforeCommentEdge } from "coral-stream/__generated__/LiveChatContainerBeforeCommentEdge.graphql";
import { LiveChatContainerLocal } from "coral-stream/__generated__/LiveChatContainerLocal.graphql";
import { LiveCommentContainer_comment } from "coral-stream/__generated__/LiveCommentContainer_comment.graphql";

import CursorState from "./cursorState";
import InView from "./InView";
import LiveCommentContainer from "./LiveComment";
import LiveCommentEnteredSubscription from "./LiveCommentEnteredSubscription";
import LiveCommentConversationContainer from "./LiveCommentReply/LiveCommentConversationContainer";
import LivePostCommentFormContainer from "./LivePostCommentFormContainer";

import styles from "./LiveChatContainer.css";

/**
 * scrollElement is a version of Element.scroll but also works in older browsers.
 *
 * TODO: (cvle) for some reason polyfilling Element.prototype failed.
 */
function scrollElement(element: Element, options: ScrollToOptions) {
  if (element.scroll) {
    element.scroll(options);
  } else {
    if (options.left !== undefined) {
      element.scrollLeft = options.left;
    }
    if (options.top !== undefined) {
      element.scrollTop = options.top;
    }
  }
}

interface ConversationViewState {
  visible: boolean;
  comment?:
    | PropTypesOf<typeof LiveCommentConversationContainer>["comment"]
    | null;
  type?: "conversation" | "parent" | "reply" | "replyToParent";
}

interface Props {
  beforeComments: LiveChatContainerBeforeCommentEdge;
  beforeHasMore: boolean;
  loadMoreBefore: () => Promise<void>;
  isLoadingMoreBefore: boolean;

  afterComments: LiveChatContainerAfterCommentEdge;
  afterHasMore: boolean;
  loadMoreAfter: () => Promise<void>;
  isLoadingMoreAfter: boolean;

  viewer: LiveChatContainer_viewer | null;
  settings: LiveChatContainer_settings;
  story: LiveChatContainer_story;

  cursorSet?: boolean;
  setCursor: (cursor: string) => void;
}

interface NewComment {
  id: string;
  cursor: string;
}

const LiveChatContainer: FunctionComponent<Props> = ({
  beforeComments,
  beforeHasMore,
  loadMoreBefore,
  isLoadingMoreBefore,
  afterComments,
  afterHasMore,
  loadMoreAfter,
  isLoadingMoreAfter,
  viewer,
  settings,
  story,
  cursorSet,
  setCursor,
}) => {
  const context = useCoralContext();
  const [
    {
      storyID,
      storyURL,
      liveChat: { tailing },
    },
    setLocal,
  ] = useLocal<LiveChatContainerLocal>(graphql`
    fragment LiveChatContainerLocal on Local {
      storyID
      storyURL
      liveChat {
        tailing
      }
    }
  `);

  const banned = !!viewer?.status.current.includes(GQLUSER_STATUS.BANNED);
  const suspended = !!viewer?.status.current.includes(GQLUSER_STATUS.SUSPENDED);
  const warned = !!viewer?.status.current.includes(GQLUSER_STATUS.WARNED);

  const showCommentForm = !banned && !suspended && !warned;

  const containerRef = useRef<any | null>(null);
  const beginRef = useRef<any | null>(null);
  const beforeAfterRef = useRef<any | null>(null);

  const scrollEnabled = useRef(false);
  const lastScrollTop = useRef(0);

  const [conversationView, setConversationView] = useState<
    ConversationViewState
  >({
    visible: false,
  });

  const [newComment, setNewComment] = useState<NewComment | null>(null);

  const setTailing = useCallback(
    (value: boolean) => {
      setLocal({ liveChat: { tailing: value } });
    },
    [setLocal]
  );

  const scrollToBeforeAfter = useCallback(
    (behavior?: string) => {
      const beforeAfter = beforeAfterRef.current;
      beforeAfter.scrollIntoView({ behavior, block: "center" });
    },
    [beforeAfterRef]
  );

  const scrollToEnd = useCallback(
    (behavior?: ScrollOptions["behavior"]) => {
      const height = containerRef.current.scrollHeight;
      scrollElement(containerRef.current, { left: 0, top: height, behavior });
    },
    [containerRef]
  );

  useEffect(() => {
    if (beforeCommentsIncoming.current || afterCommentsIncoming.current) {
      return;
    }

    if (cursorSet) {
      scrollToBeforeAfter();
    } else {
      scrollToEnd();
      setTailing(true);
    }

    if (containerRef.current) {
      lastScrollTop.current = containerRef.current.scrollTop;
    }

    // Enable scroll in a bit
    const timeoutReg = window.setTimeout(() => {
      scrollEnabled.current = true;
    }, 300);

    // Cleanup
    return () => {
      clearTimeout(timeoutReg);
    };
  }, [
    scrollToEnd,
    scrollEnabled,
    story.id,
    setTailing,
    cursorSet,
    scrollToBeforeAfter,
  ]);

  /** Scroll */

  const prevScrollHeight = useRef<number | null>(null);
  const prevScrollTop = useRef<number | null>(null);

  const clearScrollStateTimeout = useRef<number | null>(null);
  const clearScrollState = useCallback(() => {
    prevScrollHeight.current = null;
    prevScrollTop.current = null;
    beforeCommentsIncoming.current = false;
    afterCommentsIncoming.current = false;
  }, []);

  const maintainPrevScrollState = useCallback(() => {
    if (prevScrollHeight.current !== null && prevScrollTop.current !== null) {
      const currentHeight = containerRef.current.scrollHeight;

      const prevScroll = prevScrollTop.current > 0 ? prevScrollTop.current : 0;
      const offset = currentHeight - prevScrollHeight.current;

      containerRef.current.scrollTop = offset + prevScroll;
    }
  }, []);

  const maintainPrevScrollStateAndClear = useCallback(() => {
    maintainPrevScrollState();

    if (clearScrollStateTimeout.current) {
      clearTimeout(clearScrollStateTimeout.current);
    }

    clearScrollStateTimeout.current = window.setTimeout(clearScrollState, 300);
  }, [clearScrollState, maintainPrevScrollState]);

  /** Scroll END */

  /** Before Scroll */

  const beforeCommentsIncoming = useRef(false);
  const beforeMaintainScrollStateTimeout = useRef<number | null>(null);

  const beforeCommentsChanged = useCallback(() => {
    if (beforeMaintainScrollStateTimeout.current) {
      clearTimeout(beforeMaintainScrollStateTimeout.current);
    }

    const isSafari = navigator.userAgent.match(/iPhone|iPad|iPod/i);
    if (isSafari) {
      beforeMaintainScrollStateTimeout.current = window.setTimeout(
        maintainPrevScrollStateAndClear,
        500
      );
    } else {
      maintainPrevScrollStateAndClear();
    }
  }, [maintainPrevScrollStateAndClear]);

  const onBeginInView = useCallback(async () => {
    if (
      beforeHasMore &&
      !isLoadingMoreBefore &&
      !beforeCommentsIncoming.current
    ) {
      try {
        beforeCommentsIncoming.current = true;

        prevScrollHeight.current = containerRef.current.scrollHeight;
        prevScrollTop.current = containerRef.current.scrollTop;

        LiveChatLoadBeforeEvent.emit(context.eventEmitter, {
          storyID: story.id,
          viewerID: viewer ? viewer.id : "",
        });

        await loadMoreBefore();
      } catch (err) {
        // ignore for now
      }
    }
  }, [
    beforeHasMore,
    context.eventEmitter,
    isLoadingMoreBefore,
    loadMoreBefore,
    story.id,
    viewer,
  ]);

  useEffectAtUnmount(() => {
    if (beforeMaintainScrollStateTimeout.current) {
      clearTimeout(beforeMaintainScrollStateTimeout.current);
    }
    if (clearScrollStateTimeout.current) {
      clearTimeout(clearScrollStateTimeout.current);
    }
  });

  /** Before Scroll END */

  /** After Scroll */

  const afterCommentsIncoming = useRef(false);
  const afterMaintainScrollStateTimeout = useRef<number | null>(null);
  const tailingScrollTimeout = useRef<number | null>(null);
  const afterTailingScrollTimeout = useRef<number | null>(null);

  const paginateNewAfterComments = useCallback(() => {
    if (afterMaintainScrollStateTimeout.current) {
      clearTimeout(afterMaintainScrollStateTimeout.current);
    }

    const isSafari = navigator.userAgent.match(/iPhone|iPad|iPod/i);
    if (isSafari) {
      afterMaintainScrollStateTimeout.current = window.setTimeout(
        maintainPrevScrollStateAndClear,
        500
      );
    } else {
      maintainPrevScrollStateAndClear();
    }
  }, [maintainPrevScrollStateAndClear]);

  const afterTailingScroll = useCallback(() => {
    scrollEnabled.current = true;
  }, []);

  const performTailingScroll = useCallback(() => {
    scrollEnabled.current = false;
    scrollToEnd("smooth");

    if (afterTailingScrollTimeout.current) {
      window.clearTimeout(afterTailingScrollTimeout.current);
    }

    afterTailingScrollTimeout.current = window.setTimeout(
      afterTailingScroll,
      100
    );
  }, [afterTailingScroll, scrollToEnd]);

  const afterCommentsChanged = useCallback(() => {
    if (afterCommentsIncoming.current && !tailing) {
      paginateNewAfterComments();
    } else if (tailing) {
      if (tailingScrollTimeout.current) {
        window.clearTimeout(tailingScrollTimeout.current);
      }

      scrollEnabled.current = false;
      tailingScrollTimeout.current = window.setTimeout(
        performTailingScroll,
        100
      );
    }
  }, [paginateNewAfterComments, performTailingScroll, tailing]);

  useEffectAtUnmount(() => {
    if (afterMaintainScrollStateTimeout.current) {
      clearTimeout(afterMaintainScrollStateTimeout.current);
    }
  });

  const onEndInView = useCallback(async () => {
    if (
      afterHasMore &&
      !isLoadingMoreAfter &&
      !afterCommentsIncoming.current &&
      !tailing
    ) {
      try {
        afterCommentsIncoming.current = true;
        setTailing(false);
        await loadMoreAfter();
      } catch (err) {
        // ignore for now
      }
    }
  }, [afterHasMore, isLoadingMoreAfter, loadMoreAfter, setTailing, tailing]);

  /** After Scroll END */

  /** Tailing Scroll */

  const onScroll = useCallback(
    async (e) => {
      const container = containerRef.current;
      const begin = beginRef.current;

      if (!container || !begin || !scrollEnabled) {
        return;
      }

      const atBottom =
        Math.abs(
          container.scrollTop -
            (container.scrollHeight - container.offsetHeight)
        ) < 5;

      setTailing(atBottom && !afterHasMore);
    },
    [afterHasMore, setTailing]
  );

  const onTailingInView = useCallback(async () => {
    if (
      !afterHasMore &&
      !isLoadingMoreAfter &&
      !afterCommentsIncoming.current
    ) {
      setTailing(true);
    }
  }, [afterHasMore, isLoadingMoreAfter, setTailing]);

  /** Tailing Scroll END */

  useEffectAfterMount(() => {
    beforeCommentsChanged();
  }, [beforeComments, beforeCommentsChanged]);

  useEffectAfterMount(() => {
    afterCommentsChanged();
  }, [afterComments, afterCommentsChanged]);

  const subscribeToCommentEntered = useSubscription(
    LiveCommentEnteredSubscription
  );

  useEffect(() => {
    const disposable = subscribeToCommentEntered({
      storyID: story.id,
      orderBy: GQLCOMMENT_SORT.CREATED_AT_ASC,
      storyConnectionKey: "Chat_after",
    });

    return () => {
      disposable.dispose();
    };
  }, [story.id, subscribeToCommentEntered, afterHasMore]);

  const onCommentVisible = useCallback(
    async (visible: boolean, id: string, createdAt: string, cursor: string) => {
      // Set the constant updating cursor
      const key = `liveCursor:${storyID}:${storyURL}`;

      const rawValue = await context.localStorage.getItem(key);
      let current: CursorState | null = null;
      if (rawValue) {
        current = JSON.parse(rawValue);
      }

      if (current && new Date(createdAt) > new Date(current.createdAt)) {
        await context.localStorage.setItem(
          key,
          JSON.stringify({
            createdAt,
            cursor,
          })
        );
      } else if (!current) {
        await context.localStorage.setItem(
          key,
          JSON.stringify({
            createdAt,
            cursor,
          })
        );
      }

      // Hide the "Jump to new comment" button if we can see its target comment
      if (newComment && newComment.id === id) {
        setNewComment(null);
      }
    },
    [context.localStorage, newComment, storyID, storyURL]
  );

  const onShowConv = useCallback(
    (
      comment:
        | LiveCommentContainer_comment
        | NonNullable<LiveCommentContainer_comment["parent"]>,
      type: Required<ConversationViewState>["type"]
    ) => {
      LiveChatOpenConversationEvent.emit(context.eventEmitter, {
        storyID: story.id,
        commentID: comment.id,
        viewerID: viewer ? viewer.id : "",
        type,
      });

      setConversationView({
        visible: true,
        comment,
        type,
      });
    },
    [context.eventEmitter, story.id, viewer]
  );

  const onReplyToComment = useCallback(
    (comment: LiveCommentContainer_comment) => {
      onShowConv(comment, "reply");
    },
    [onShowConv]
  );
  const onReplyToParent = useCallback(
    (parent: NonNullable<LiveCommentContainer_comment["parent"]>) => {
      onShowConv(parent, "replyToParent");
    },
    [onShowConv]
  );

  const onShowConversation = useCallback(
    (comment: LiveCommentContainer_comment) => {
      onShowConv(comment, "conversation");
    },
    [onShowConv]
  );

  const onShowParentConversation = useCallback(
    (parent: NonNullable<LiveCommentContainer_comment["parent"]>) => {
      onShowConv(parent, "parent");
    },
    [onShowConv]
  );

  const onCloseConversation = useCallback(() => {
    setConversationView({
      visible: false,
      comment: null,
    });
  }, [setConversationView]);

  const scrollToCommentTimeout = useRef<number | null>(null);
  const scrollToComment = useCallback(() => {
    if (!newComment) {
      return;
    }

    const el = document.getElementById(`comment-${newComment.id}-bottom`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }

    setNewComment(null);
  }, [newComment, setNewComment]);

  const jumpToComment = useCallback(() => {
    if (!newComment) {
      return;
    }

    setCursor(newComment.cursor);

    LiveJumpToCommentEvent.emit(context.eventEmitter, {
      storyID: story.id,
      commentID: newComment.id,
      viewerID: viewer ? viewer.id : "",
    });

    if (scrollToCommentTimeout.current) {
      window.clearTimeout(scrollToCommentTimeout.current);
    }

    window.setTimeout(scrollToComment, 300);
  }, [
    newComment,
    setCursor,
    scrollToComment,
    story.id,
    viewer,
    context.eventEmitter,
  ]);

  const onCommentSubmitted = useCallback(
    (commentID: string, cursor: string) => {
      if (!commentID || !cursor) {
        return;
      }

      if (!tailing) {
        setNewComment({ id: commentID, cursor });
      }
    },
    [tailing, setNewComment]
  );

  const closeJumpToComment = useCallback(() => {
    if (!newComment) {
      return;
    }

    setNewComment(null);
  }, [newComment, setNewComment]);

  return (
    <>
      {afterComments.length === 0 && beforeComments.length === 0 && (
        <Localized id="comments-noCommentsYet">
          <CallOut color="primary">
            There are no comments yet. Why don't you write one?
          </CallOut>
        </Localized>
      )}
      <IntersectionProvider>
        <div
          id="live-chat-comments"
          className={styles.streamContainer}
          ref={containerRef}
          onScroll={onScroll}
        >
          <div id="begin" ref={beginRef} className={styles.begin}>
            <InView onInView={onBeginInView} />
          </div>
          <div id="pre-before"></div>

          {beforeComments.map((e) => (
            <LiveCommentContainer
              key={e.node.id}
              story={story}
              comment={e.node}
              cursor={e.cursor}
              viewer={viewer}
              settings={settings}
              onInView={onCommentVisible}
              onShowConversation={onShowConversation}
              onShowParentConversation={onShowParentConversation}
              onReplyToComment={onReplyToComment}
              onReplyToParent={onReplyToParent}
            />
          ))}

          <div id="before-after" ref={beforeAfterRef}>
            {afterComments && afterComments.length > 0 && (
              <Flex justifyContent="center" alignItems="center">
                <hr className={styles.newhr} />
                <div className={styles.newDiv}>
                  New <Icon size="md">arrow_downward</Icon>
                </div>
                <hr className={styles.newhr} />
              </Flex>
            )}
          </div>

          {afterComments.map((e) => (
            <LiveCommentContainer
              key={e.node.id}
              story={story}
              comment={e.node}
              cursor={e.cursor}
              viewer={viewer}
              settings={settings}
              onInView={onCommentVisible}
              onShowConversation={onShowConversation}
              onShowParentConversation={onShowParentConversation}
              onReplyToComment={onReplyToComment}
              onReplyToParent={onReplyToParent}
            />
          ))}

          <div id="end" className={styles.end}>
            <InView onInView={onEndInView} />
          </div>
          <div id="tailing" className={styles.tailing}>
            <InView onInView={onTailingInView} />
          </div>
          <div className={styles.endFooter}></div>
        </div>
      </IntersectionProvider>

      {/* TODO: Refactoring canditate */}
      {newComment && (
        <div className={styles.scrollToNewReply}>
          <Flex justifyContent="center" alignItems="center">
            <Flex alignItems="center">
              <Button
                onClick={jumpToComment}
                color="primary"
                className={styles.jumpButton}
              >
                Message posted below <Icon>arrow_downward</Icon>
              </Button>
              <Button
                onClick={closeJumpToComment}
                color="primary"
                aria-valuetext="close"
                className={styles.jumpButtonClose}
              >
                <Icon>close</Icon>
              </Button>
            </Flex>
          </Flex>
        </div>
      )}
      {conversationView.visible && conversationView.comment && (
        <LiveCommentConversationContainer
          settings={settings}
          viewer={viewer}
          story={story}
          comment={conversationView.comment}
          visible={conversationView.visible}
          onClose={onCloseConversation}
        />
      )}
      {showCommentForm && (
        <LivePostCommentFormContainer
          settings={settings}
          story={story}
          viewer={viewer}
          commentsOrderBy={GQLCOMMENT_SORT.CREATED_AT_ASC}
          onSubmitted={onCommentSubmitted}
        />
      )}
    </>
  );
};

const enhanced = withFragmentContainer<Props>({
  beforeComments: graphql`
    fragment LiveChatContainerBeforeCommentEdge on CommentEdge
      @relay(plural: true) {
      cursor
      node {
        id
        ...LiveCommentContainer_comment
      }
    }
  `,
  afterComments: graphql`
    fragment LiveChatContainerAfterCommentEdge on CommentEdge
      @relay(plural: true) {
      cursor
      node {
        id
        ...LiveCommentContainer_comment
      }
    }
  `,
  story: graphql`
    fragment LiveChatContainer_story on Story {
      id
      url
      ...LivePostCommentFormContainer_story
      ...LiveCommentConversationContainer_story
      ...LiveCommentContainer_story
    }
  `,
  viewer: graphql`
    fragment LiveChatContainer_viewer on User {
      id
      status {
        current
      }
      ...LivePostCommentFormContainer_viewer
      ...LiveCommentContainer_viewer
      ...LiveCommentConversationContainer_viewer
    }
  `,
  settings: graphql`
    fragment LiveChatContainer_settings on Settings {
      ...LivePostCommentFormContainer_settings
      ...LiveCommentContainer_settings
      ...LiveCommentConversationContainer_settings
    }
  `,
})(LiveChatContainer);

export default enhanced;
