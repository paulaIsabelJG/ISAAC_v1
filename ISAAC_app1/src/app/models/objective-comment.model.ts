export interface CommentCreator {
  _id:              string;
  name:             string;
  surname?:         string;
  type:             string;   // 'teacher' | 'parent' | 'user'
  professionalType?: string | null;
}

export interface ObjectiveComment {
  _id:          string;
  text:         string;
  createdBy:    CommentCreator;
  targetUserId: string;
  createdAt:    string;  // ISO
  updatedAt:    string;  // ISO
}
