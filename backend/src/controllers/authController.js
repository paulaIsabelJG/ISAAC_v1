const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Phrase = require('../models/Phrase');

// Register endpoint
exports.register = async (req, res) => {
  try {
    const { email, name, password, type = 'user', gender, image, centro } = req.body;

    // Validate input
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Email, name, and password are required' });
    }

    // Validate user type
    const allowedTypes = ['teacher', 'parent', 'user'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid user type. Must be: teacher, parent, or user' });
    }

    // Validate gender if provided
    if (gender) {
      const allowedGenders = ['male', 'female', 'other', 'prefer_not_to_say'];
      if (!allowedGenders.includes(gender)) {
        return res.status(400).json({ error: 'Invalid gender. Must be: male, female, other, or prefer_not_to_say' });
      }
    }

    // Validate centro requirement for teachers and users
    if ((type === 'teacher' || type === 'user') && !centro) {
      return res.status(400).json({ error: `Centro is required for ${type} users` });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Create new user
    const user = new User({
      name,
      email,
      password,
      type,
      gender,
      image,
      centro: centro || null
    });

    await user.save();

    // Return user without password
    const userResponse = {
      id: user._id,
      name: user.name,
      email: user.email,
      type: user.type,
      gender: user.gender,
      image: user.image,
      createdAt: user.createdAt
    };


    res.status(201).json({
      message: 'User registered successfully',
      user: userResponse
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
};

// Login endpoint
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Compare password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Return token and user without password
    const userResponse = {
      id: user._id,
      name: user.name,
      email: user.email,
      type: user.type,
      gender: user.gender,
      image: user.image,
      createdAt: user.createdAt
    };

    res.status(200).json({
      message: 'Login successful',
      token,
      user: userResponse
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
};

// Get current user endpoint
exports.getMe = async (req, res) => {
  try {
    // userId is attached to req by auth middleware
    const userId = req.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Return user without password
    const userResponse = {
      id: user._id,
      name: user.name,
      email: user.email,
      type: user.type,
      gender: user.gender,
      image: user.image,
      createdAt: user.createdAt
    };

    res.status(200).json({
      message: 'User retrieved successfully',
      user: userResponse
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error while retrieving user' });
  }
};

// Update current user endpoint
exports.updateMe = async (req, res) => {
  try {
    const userId = req.userId;
    const { name, email, type, gender, image, centro, hijos, parentId } = req.body;

    // Validate input - at least one field must be provided
    if (!name && !email && !type && !gender && image === undefined && !centro && !hijos && !parentId) {
      return res.status(400).json({ error: 'Provide at least name, email, type, gender, image, centro, hijos, or parentId to update' });
    }

    // Find the current user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Validate user type if provided
    if (type) {
      const allowedTypes = ['teacher', 'parent', 'user'];
      if (!allowedTypes.includes(type)) {
        return res.status(400).json({ error: 'Invalid user type. Must be: teacher, parent, or user' });
      }
    }

    // Validate gender if provided
    if (gender) {
      const allowedGenders = ['male', 'female', 'other', 'prefer_not_to_say'];
      if (!allowedGenders.includes(gender)) {
        return res.status(400).json({ error: 'Invalid gender. Must be: male, female, other, or prefer_not_to_say' });
      }
    }

    // Validate centro if provided
    if (centro !== undefined) {
      if (typeof centro !== 'string' && centro !== null) {
        return res.status(400).json({ error: 'Centro must be a string' });
      }
    }

    // Validate centro requirement after type change
    if (type && (type === 'teacher' || type === 'user')) {
      const newCentro = centro !== undefined ? centro : user.centro;
      if (!newCentro) {
        return res.status(400).json({ error: `Centro is required for ${type} users` });
      }
    }

    // Validate hijos if provided
    if (hijos !== undefined) {
      if (!Array.isArray(hijos)) {
        return res.status(400).json({ error: 'Hijos must be an array of ObjectIds' });
      }
      // Validate each hijo is a valid ObjectId
      for (const hijoId of hijos) {
        if (!mongoose.Types.ObjectId.isValid(hijoId)) {
          return res.status(400).json({ error: 'All hijos must be valid ObjectIds' });
        }
      }
    }

    // Validate parentId if provided
    if (parentId !== undefined) {
      if (parentId && !mongoose.Types.ObjectId.isValid(parentId)) {
        return res.status(400).json({ error: 'ParentId must be a valid ObjectId' });
      }
    }

    // Check if email is already taken by another user
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ error: 'Email already taken by another user' });
      }
    }

    // Store previous state for relationship synchronization
    const previousState = {
      type: user.type,
      parentId: user.parentId ? user.parentId.toString() : null,
      hijos: Array.isArray(user.hijos) ? user.hijos.map((h) => h.toString()) : []
    };

    // Update only provided fields
    if (name) user.name = name;
    if (email) user.email = email;
    if (type) user.type = type;
    if (gender) user.gender = gender;
    if (image !== undefined) user.image = image;
    if (centro !== undefined) user.centro = centro;
    if (hijos !== undefined) user.hijos = hijos;
    if (parentId !== undefined) user.parentId = parentId;

    await user.save();

    // Synchronize relationships if type changed
    if (type && previousState.type !== type) {
      if (previousState.type === 'parent' && type !== 'parent') {
        // Removing parent status - unlink children
        const children = await User.find({ _id: { $in: previousState.hijos } });
        for (const child of children) {
          if (child.parentId && child.parentId.toString() === userId) {
            child.parentId = null;
            await child.save();
          }
        }
      }

      if (previousState.type === 'user' && type !== 'user' && previousState.parentId) {
        // Removing user status - unlink from parent
        const parent = await User.findById(previousState.parentId);
        if (parent) {
          parent.hijos = parent.hijos.filter((h) => h.toString() !== userId);
          await parent.save();
        }
      }

      if (type === 'parent' && user.hijos && user.hijos.length > 0) {
        // Setting as parent - link hijos
        const children = await User.find({ _id: { $in: user.hijos } });
        for (const child of children) {
          child.parentId = userId;
          await child.save();
        }
      }

      if (type === 'user' && user.parentId) {
        // Setting as user with parent - link to parent
        const parent = await User.findById(user.parentId);
        if (parent && !parent.hijos.some((h) => h.toString() === userId)) {
          parent.hijos.push(userId);
          await parent.save();
        }
      }
    }

    // Return updated user without password
    const userResponse = {
      id: user._id,
      name: user.name,
      email: user.email,
      type: user.type,
      gender: user.gender,
      image: user.image,
      centro: user.centro,
      hijos: user.hijos,
      parentId: user.parentId,
      createdAt: user.createdAt
    };

    res.status(200).json({
      message: 'User updated successfully',
      user: userResponse
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error while updating user' });
  }
};

// Delete current user endpoint
exports.deleteMe = async (req, res) => {
  try {
    const userId = req.userId;

    // Find the user to confirm they exist
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete all phrases associated with this user
    await Phrase.deleteMany({ userId });

    // Delete the user account
    await User.findByIdAndDelete(userId);

    res.status(200).json({
      message: 'User account and associated phrases deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error while deleting user' });
  }
};
