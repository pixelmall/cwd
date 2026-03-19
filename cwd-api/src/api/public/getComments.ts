import { Context } from 'hono'
import { Bindings } from '../../bindings'
import { getCravatar } from '../../utils/getAvatar'
import { decodePostSlug, getAllSlugFormats, escapeLikePattern } from '../../utils/decodePostSlug'

export const getComments = async (c: Context<{ Bindings: Bindings }>) => {
  const rawPostSlug = c.req.query('post_slug') || ''
  const postSlug = decodePostSlug(rawPostSlug)
  const page = parseInt(c.req.query('page') || '1')
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50)
  const nested = c.req.query('nested') !== 'false'
  const avatar_prefix = c.req.query('avatar_prefix')
  const siteId = c.req.query('site_id')
  const offset = (page - 1) * limit

  if (!postSlug) return c.json({ message: "post_slug is required" }, 400)

  let slugList: string[] = [postSlug]
  try {
    const url = new URL(postSlug)
    const origin = url.origin
    const path = url.pathname || '/'
    if (path === '/') {
      const withSlash = origin + '/'
      const withoutSlash = origin
      slugList = Array.from(new Set([withSlash, withoutSlash]))
    } else {
      const hasTrailingSlash = path.endsWith('/')
      const withSlash = origin + (hasTrailingSlash ? path : path + '/')
      const withoutSlash = origin + (hasTrailingSlash ? path.slice(0, -1) : path)
      slugList = Array.from(new Set([withSlash, withoutSlash]))
    }
  } catch {
    const path = postSlug.split('?')[0].split('#')[0]
    if (path === '/' || path === '') {
      slugList = ['/']
    } else {
      const hasTrailingSlash = path.endsWith('/')
      const withSlash = hasTrailingSlash ? path : path + '/'
      const withoutSlash = hasTrailingSlash ? path.slice(0, -1) : path
      slugList = Array.from(new Set([withSlash, withoutSlash]))
    }
  }

  try {
    const allSlugFormats = new Set<string>()
    for (const s of slugList) {
      for (const format of getAllSlugFormats(s)) {
        allSlugFormats.add(format)
      }
    }
    const equalSlugs = Array.from(allSlugFormats)
    
    const whereParts: string[] = []
    if (equalSlugs.length === 1) {
      whereParts.push('post_slug = ?')
    } else if (equalSlugs.length > 1) {
      const placeholders = equalSlugs.map(() => '?').join(', ')
      whereParts.push(`post_slug IN (${placeholders})`)
    }
    const whereClause =
      whereParts.length > 0
        ? `(${whereParts.join(' OR ')})`
        : '1=1'
    
    let finalWhereClause = `status = "approved" AND ${whereClause}`
    const bindParams: unknown[] = [...equalSlugs]

    if (siteId) {
      finalWhereClause += ' AND site_id = ?'
      bindParams.push(siteId)
    }

    const query = `
      SELECT id, name, email, url, content_text as contentText,
             content_html as contentHtml, created, parent_id as parentId,
             post_slug as postSlug, post_url as postUrl, priority, COALESCE(likes, 0) as likes
      FROM Comment
      WHERE ${finalWhereClause}
      ORDER BY priority DESC, created DESC
    `
    
    const [commentsResult, adminEmailRows] = await Promise.all([
      c.env.CWD_DB.prepare(query).bind(...bindParams).all(),
      c.env.CWD_DB.prepare('SELECT key, value FROM Settings WHERE key IN (?, ?)')
        .bind('comment_admin_email', 'admin_notify_email')
        .all<{ key: string; value: string }>()
        .catch(() => null)
    ]);

    const results = commentsResult.results;
    let adminEmail: string | null = null;
    if (adminEmailRows && Array.isArray(adminEmailRows.results)) {
      const commentEmailRow = adminEmailRows.results.find(
        (row) => row.key === 'comment_admin_email'
      );
      const legacyEmailRow = adminEmailRows.results.find(
        (row) => row.key === 'admin_notify_email'
      );
      adminEmail = commentEmailRow?.value || legacyEmailRow?.value || null;
    }

    // 2. 批量处理头像并格式化
    const allComments = await Promise.all(results.map(async (row: any) => ({
      ...row,
      avatar: await getCravatar(row.email, row.name, avatar_prefix || undefined),
      isAdmin: adminEmail && row.email === adminEmail,
      replies: []
    })))

    // 3. 处理嵌套逻辑（扁平化：2级往后的回复都放在根评论的 replies 中）
    if (nested) {
      const commentMap = new Map()
      const rootComments: any[] = []

      // 建立评论映射
      allComments.forEach(comment => commentMap.set(comment.id, comment))

      // 找出所有根评论
      allComments.forEach(comment => {
        if (!comment.parentId) {
          rootComments.push(comment)
        }
      })

      // 为每个非根评论找到其根评论，并添加 replyToAuthor 字段
      allComments.forEach(comment => {
        if (comment.parentId) {
          // 获取直接父评论的作者名
          const parentComment = commentMap.get(comment.parentId)
          if (parentComment) {
            comment.replyToAuthor = parentComment.name
          }

          // 向上查找根评论
          let rootId = comment.parentId
          let current = commentMap.get(rootId)
          while (current && current.parentId) {
            rootId = current.parentId
            current = commentMap.get(rootId)
          }

          // 将回复添加到根评论的 replies 中
          const rootComment = commentMap.get(rootId)
          if (rootComment && !rootComment.parentId) {
            rootComment.replies.push(comment)
          }
        }
      })

      // 对每个根评论的 replies 按时间正序排列
      rootComments.forEach(root => {
        root.replies.sort((a: any, b: any) =>
          a.created - b.created
        )
      })

      // 对根评论进行分页
      const paginatedData = rootComments.slice(offset, offset + limit)
      return c.json({
        data: paginatedData,
        pagination: {
          page,
          limit,
          total: Math.ceil(rootComments.length / limit),
          totalCount: allComments.length,
        }
      })
    } else {
      // 非嵌套逻辑直接分页
      const paginatedData = allComments.slice(offset, offset + limit)
      return c.json({
        data: paginatedData,
        pagination: {
          page,
          limit,
          total: Math.ceil(allComments.length / limit),
          totalCount: allComments.length,
        }
      })
    }
  } catch (e: any) {
    return c.json({ message: e.message }, 500)
  }
}
